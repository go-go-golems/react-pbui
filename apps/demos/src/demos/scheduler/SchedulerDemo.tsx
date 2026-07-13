/* Dynamic Windows Scheduler — port of sources/dynamic-windows-scheduler.jsx
 * onto PBUI.
 *
 * A Symbolics Genera / CLIM-style Gantt scheduler for the NASA STS-31
 * payload-integration flow. The signature features survive the port:
 *
 *   - a presentation-type lattice  MILESTONE ⊂ TASK  (and MONTH beside it):
 *     a TASK input context accepts milestones, but "Slip Milestone" and
 *     "Anchor End" demand a true MILESTONE — only triangles grow rings;
 *   - multi-argument verbs collected through sequential input contexts,
 *     suppliable by pointing at the chart OR at names printed earlier in
 *     the listener — every task the commands mention is printed as a live
 *     presentation part, so printed names stay mouse-sensitive forever;
 *   - stale-presentation handling: commands re-resolve their arguments at
 *     execution time and report "… presentation was stale." when the
 *     object has since been deleted (e.g. via Combine Tasks / Delete Task).
 *
 * PORTING-GAPS:
 *   - PBUI has no accepting-values dialog primitive, so the original's
 *     Look/Modify and Create Task dialogs (dynamic-windows-scheduler.jsx:709)
 *     are not ported; left-click now defaults to "Inspect Task" and edits
 *     happen through commands (Move/Swap/Combine/Convert/…).
 *   - No function-key strip in @go-go-golems/pbui-chrome; the original FKEYS row
 *     (RESHAPE/CREATE/…/EXIT) is dropped — its verbs are reachable from
 *     context menus and the command line instead.
 */

import { useEffect, useMemo, useRef } from "react";
import {
  B,
  CommandTable,
  P,
  PbuiEngine,
  PTypes,
  defineBuiltinPtypes,
  valueRef,
  type ObjectRef,
  type OutputPart,
  type ParseResult,
  type PartLike,
  type Resolver,
} from "@go-go-golems/pbui-core";
import {
  PbuiProvider,
  SvgPresentation,
  useEngine,
  usePbuiSurface,
} from "@go-go-golems/pbui-react";
import { ContextMenuHost, MouseDocBar, Pane, StatusLine } from "@go-go-golems/pbui-chrome";
import { Listener } from "@go-go-golems/pbui-listener";
import { Store, useStore } from "../../lib/store.js";

/* --------------------------------- domain ---------------------------------- */

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ORIGIN_Y = 1988;
const ORIGIN_M = 4; // Apr 1988 .. Sep 1989
const NM = 18;
const MW = 58; // px per month
const LM = 14;
const HH = 46;
const TITLE_H = 18;
const RH = 23;
const PAD_R = 260;

const mx = (i: number) => LM + i * MW;
const ymOf = (i: number) => {
  const t = ORIGIN_M - 1 + i;
  return { y: ORIGIN_Y + Math.floor(t / 12), m: (t % 12) + 1 };
};
const fmtYM = (i: number) => {
  const { y, m } = ymOf(i);
  return `${MONTH_NAMES[m - 1]!.toUpperCase()} ${y}`;
};
const clampMonth = (i: number) => Math.max(0, Math.min(NM - 1, i));
const durLabel = (n: number) => `${n} month${n === 1 ? "" : "s"}`;

type TaskKind = "task" | "milestone";

interface Task {
  id: string;
  name: string;
  start: number; // month index 0..NM-1
  end: number;
  kind: TaskKind;
  depth: number;
}

let seq = 100;
const T = (name: string, start: number, end: number, kind: TaskKind = "task", depth = 0): Task => ({
  id: "t" + seq++,
  name,
  start,
  end,
  kind,
  depth,
});

function sampleTasks(): Task[] {
  seq = 100;
  return [
    T("launch for sts-31", 16, 16, "milestone"),
    T("sts-31", 0, 16),
    T("ASTRO-1", 0, 16),
    T("exp-mpe-on-dock-ksc for sts-31", 0, 0, "milestone"),
    T("Level-IV", 1, 7),
    T("igloo-carrier-staging", 1, 4, "task", 1),
    T("pre-experiment-integration", 1, 3, "task", 1),
    T("pallet-igloo-integration", 4, 6, "task", 2),
    T("install-freon-pump-pkg-on-frame", 4, 5, "task", 2),
    T("install-experiment-inverter", 4, 5, "task", 2),
    T("connect-pallet-utilities", 5, 6, "task", 2),
    T("start-experiment-integration for sts-31", 5, 5, "milestone", 1),
    T("experiment-integration", 5, 9, "task", 1),
    T("experiment-installation", 5, 7, "task", 2),
    T("pcu-preps-for-test", 6, 7, "task", 2),
    T("Level-IV-test", 7, 9, "task", 1),
    T("power-off-closeout", 8, 9, "task", 2),
    T("preps-for-level-iii-ii", 8, 9, "task", 2),
    T("transfer-payload-to-level-iii-ii for sts-31", 8, 8, "milestone"),
    T("Level-III-II", 8, 11),
    T("start-cite-ops for sts-31", 9, 9, "milestone"),
    T("CITE-OPS", 9, 12),
    T("transfer-to-canister for sts-31", 12, 12, "milestone"),
    T("Level-I", 12, 14),
    T("fly-mission", 14, 15),
    T("deintegration", 16, 17),
  ];
}

/* --------------------------------- engine ---------------------------------- */

interface SchedState {
  tasks: Task[];
}

interface World {
  store: Store<SchedState>;
  task(id: string): Task | undefined;
}

function makeWorld(): World {
  const store = new Store<SchedState>({ tasks: sampleTasks() });
  return {
    store,
    task: (id) => store.get().tasks.find((t) => t.id === id),
  };
}

const ptypeOf = (t: Task) => (t.kind === "milestone" ? "milestone" : "task");
const taskRef = (t: Task): ObjectRef => ({ kind: "task", id: t.id });
/** live task-ref part: names printed to the listener stay mouse-sensitive */
const taskPart = (t: Task): OutputPart => P(ptypeOf(t), taskRef(t), t.name);
const monthPart = (i: number): OutputPart => P("month", valueRef(i), fmtYM(i));

function parseTask(
  text: string,
  w: World,
  pred: ((t: Task) => boolean) | null,
  typeName: string,
): ParseResult<Task> {
  const q = text.trim().toLowerCase();
  const pool = w.store.get().tasks.filter((t) => !pred || pred(t));
  const hit =
    q === ""
      ? undefined
      : (pool.find((t) => t.name.toLowerCase() === q) ??
        pool.find((t) => t.name.toLowerCase().startsWith(q)));
  if (hit) return { ok: true, value: hit, ref: taskRef(hit), label: hit.name };
  return { ok: false, err: `${text.trim() || "??"} does not name a ${typeName}` };
}

function makeEngine(world: World) {
  const ptypes = new PTypes<World>();
  defineBuiltinPtypes(ptypes);

  const describeTask = (t: Task): PartLike[] => [
    B(`#<${ptypeOf(t).toUpperCase()} ${t.name.toUpperCase()}>`),
    `  is a ${ptypes.latticeLabel(ptypeOf(t))}`,
    `  span ${fmtYM(t.start)} — ${fmtYM(t.end)}  (${durLabel(t.end - t.start)}), depth ${t.depth}.`,
  ];

  ptypes.define<Task>({
    name: "task",
    print: (t) => `#<TASK ${t.name.toUpperCase()}>`,
    describe: describeTask,
    parse: (text, w) => parseTask(text, w, null, "TASK"),
    defaultCommand: "Inspect Task",
  });
  ptypes.define<Task>({
    name: "milestone",
    supertypes: ["task"],
    print: (t) => `#<MILESTONE ${t.name.toUpperCase()}>`,
    describe: describeTask,
    parse: (text, w) => parseTask(text, w, (t) => t.kind === "milestone", "MILESTONE"),
    defaultCommand: "Inspect Task",
  });
  ptypes.define<number>({
    name: "month",
    print: (m) => `#<MONTH ${fmtYM(m)}>`,
    describe: (m, w) => {
      const active = w.store.get().tasks.filter((t) => t.start <= m && t.end >= m).length;
      return [
        B(`#<MONTH ${fmtYM(m)}>`),
        `  calendar column ${m + 1} of ${NM}; ${active} task${active === 1 ? "" : "s"} active.`,
      ];
    },
    parse: (text) => {
      const q = text.trim().toUpperCase();
      if (!q) return { ok: false, err: "empty MONTH" };
      for (let i = 0; i < NM; i++)
        if (fmtYM(i) === q) return { ok: true, value: i, ref: valueRef(i), label: fmtYM(i) };
      for (let i = 0; i < NM; i++)
        if (fmtYM(i).startsWith(q)) return { ok: true, value: i, ref: valueRef(i), label: fmtYM(i) };
      return { ok: false, err: `${text.trim()} does not name a MONTH on the chart (try AUG 1988)` };
    },
  });

  const monthArg = (v: { ref: ObjectRef }): number =>
    "value" in v.ref ? (v.ref.value as number) : NaN;

  const commands = new CommandTable<World>();
  commands.defineAll([
    {
      name: "Combine Tasks",
      doc: "Merge two tasks into one span; the second task is deleted.",
      args: [
        { name: "task-a", type: "task" },
        { name: "task-b", type: "task", distinct: true },
      ],
      run: (args, api) => {
        const a = api.resolve(args["task-a"]!) as Task | undefined;
        const b = api.resolve(args["task-b"]!) as Task | undefined;
        if (!a || !b) return api.printErr("A participant vanished — presentation was stale.");
        const s = Math.min(a.start, b.start);
        const e = Math.max(a.end, b.end);
        const name = `${a.name} + ${b.name}`;
        world.store.update((st) => ({
          tasks: st.tasks
            .filter((t) => t.id !== b.id)
            .map((t) => (t.id === a.id ? { ...t, name, kind: "task" as const, start: s, end: e } : t)),
        }));
        api.print(B("Combined"), " into ", P("task", taskRef(a), name), ` spanning ${fmtYM(s)} — ${fmtYM(e)}.`);
      },
    },
    {
      name: "Swap Tasks",
      doc: "Exchange the two tasks' time spans.",
      args: [
        { name: "task-a", type: "task" },
        { name: "task-b", type: "task", distinct: true },
      ],
      run: (args, api) => {
        const a = api.resolve(args["task-a"]!) as Task | undefined;
        const b = api.resolve(args["task-b"]!) as Task | undefined;
        if (!a || !b) return api.printErr("A participant vanished — presentation was stale.");
        world.store.update((st) => ({
          tasks: st.tasks.map((t) =>
            t.id === a.id
              ? { ...t, start: b.start, end: b.end }
              : t.id === b.id
                ? { ...t, start: a.start, end: a.end }
                : t,
          ),
        }));
        api.print(B("Swapped spans"), ":  ", taskPart(a), " ⇄ ", taskPart(b), ".");
      },
    },
    {
      name: "Move Task",
      doc: "Slide the task so it starts at a month; duration preserved, clamped to the chart.",
      args: [
        { name: "task", type: "task" },
        { name: "month", type: "month" },
      ],
      run: (args, api) => {
        const a = api.resolve(args["task"]!) as Task | undefined;
        const m = monthArg(args["month"]!);
        if (!a) return api.printErr("Task vanished — presentation was stale.");
        if (Number.isNaN(m)) return api.printErr("That MONTH is not on the chart.");
        const dur = a.end - a.start;
        const ns = Math.max(0, Math.min(m, NM - 1 - dur));
        world.store.update((st) => ({
          tasks: st.tasks.map((t) => (t.id === a.id ? { ...t, start: ns, end: ns + dur } : t)),
        }));
        api.print(
          B("Moved"),
          " ",
          taskPart(a),
          ` to ${fmtYM(ns)} — ${fmtYM(ns + dur)} (duration preserved${ns !== m ? ", clamped to the chart" : ""}).`,
        );
      },
    },
    {
      name: "Link Tasks",
      doc: "Finish-to-start: the second task begins when the first ends.",
      args: [
        { name: "task-a", type: "task" },
        { name: "task-b", type: "task", distinct: true },
      ],
      run: (args, api) => {
        const p = api.resolve(args["task-a"]!) as Task | undefined;
        const s = api.resolve(args["task-b"]!) as Task | undefined;
        if (!p || !s) return api.printErr("A participant vanished — presentation was stale.");
        const dur = s.end - s.start;
        const ns = Math.max(0, Math.min(p.end, NM - 1 - dur));
        world.store.update((st) => ({
          tasks: st.tasks.map((t) => (t.id === s.id ? { ...t, start: ns, end: ns + dur } : t)),
        }));
        api.print(
          B("Linked"),
          " finish-to-start:  ",
          taskPart(s),
          " now begins at ",
          monthPart(ns),
          " when ",
          taskPart(p),
          " ends.",
        );
      },
    },
    {
      name: "Anchor End",
      doc: "Pin the task's end to a milestone (a true MILESTONE — bars are inert).",
      args: [
        { name: "task", type: "task" },
        { name: "milestone", type: "milestone" },
      ],
      run: (args, api) => {
        const a = api.resolve(args["task"]!) as Task | undefined;
        const ms = api.resolve(args["milestone"]!) as Task | undefined;
        if (!a || !ms) return api.printErr("A participant vanished — presentation was stale.");
        const ne = ms.start;
        const nsStart = Math.min(a.start, ne);
        world.store.update((st) => ({
          tasks: st.tasks.map((t) => (t.id === a.id ? { ...t, start: nsStart, end: ne } : t)),
        }));
        api.print(
          B("Anchored"),
          ":  end of ",
          taskPart(a),
          " pinned to milestone ",
          taskPart(ms),
          ` (${fmtYM(ne)}).`,
        );
      },
    },
    {
      name: "Slip Milestone",
      doc: "Move a milestone to another month (milestone-only argument).",
      args: [
        { name: "milestone", type: "milestone" },
        { name: "month", type: "month" },
      ],
      run: (args, api) => {
        const ms = api.resolve(args["milestone"]!) as Task | undefined;
        const m = monthArg(args["month"]!);
        if (!ms) return api.printErr("Milestone vanished — presentation was stale.");
        if (Number.isNaN(m)) return api.printErr("That MONTH is not on the chart.");
        world.store.update((st) => ({
          tasks: st.tasks.map((t) => (t.id === ms.id ? { ...t, start: m, end: m } : t)),
        }));
        api.print(B("Slipped"), " milestone ", taskPart(ms), " to ", monthPart(m), ".");
      },
    },
    {
      name: "Delete Task",
      doc: "Remove the task; its printed references become stale.",
      args: [{ name: "task", type: "task" }],
      run: (args, api) => {
        const a = api.resolve(args["task"]!) as Task | undefined;
        if (!a) return api.printErr("Task vanished — presentation was stale.");
        world.store.update((st) => ({ tasks: st.tasks.filter((t) => t.id !== a.id) }));
        api.print("Deleted ", B(a.name), " — every presentation of it is now stale.");
      },
    },
    {
      name: "Convert To Milestone",
      doc: "Collapse the task to a zero-duration milestone at its start.",
      appliesTo: (pres) => pres.type === "task",
      args: [{ name: "task", type: "task", where: (pres) => pres.type === "task" }],
      run: (args, api) => {
        const a = api.resolve(args["task"]!) as Task | undefined;
        if (!a) return api.printErr("Task vanished — presentation was stale.");
        if (a.kind === "milestone") return api.printErr(`${a.name} is already a MILESTONE.`);
        world.store.update((st) => ({
          tasks: st.tasks.map((t) =>
            t.id === a.id ? { ...t, kind: "milestone" as const, end: t.start } : t,
          ),
        }));
        api.print("Converted ", P("milestone", taskRef(a), a.name), " to a MILESTONE at ", monthPart(a.start), ".");
      },
    },
    {
      name: "Convert To Task",
      doc: "Give the milestone a 1-month span.",
      appliesTo: (pres) => pres.type === "milestone",
      args: [{ name: "milestone", type: "milestone" }],
      run: (args, api) => {
        const ms = api.resolve(args["milestone"]!) as Task | undefined;
        if (!ms) return api.printErr("Milestone vanished — presentation was stale.");
        if (ms.kind !== "milestone") return api.printErr(`${ms.name} is already a TASK.`);
        world.store.update((st) => ({
          tasks: st.tasks.map((t) =>
            t.id === ms.id ? { ...t, kind: "task" as const, end: clampMonth(t.start + 1) } : t,
          ),
        }));
        api.print("Converted ", P("task", taskRef(ms), ms.name), " to a TASK (given a 1-month span).");
      },
    },
    {
      name: "Inspect Task",
      doc: "Print the presentation-type lattice and the span.",
      args: [{ name: "task", type: "task" }],
      run: (args, api) => {
        const a = api.resolve(args["task"]!) as Task | undefined;
        if (!a) return api.printErr("Task vanished — presentation was stale.");
        api.print(taskPart(a), `  is a ${engine.ptypes.latticeLabel(ptypeOf(a))}`);
        api.print(`    span ${fmtYM(a.start)} — ${fmtYM(a.end)}  (${durLabel(a.end - a.start)}), depth ${a.depth}.`);
      },
    },
    {
      name: "Count Active",
      doc: "How many tasks are active during this month?",
      isDefaultFor: ["month"],
      args: [{ name: "month", type: "month" }],
      run: (args, api) => {
        const m = monthArg(args["month"]!);
        if (Number.isNaN(m)) return api.printErr("That MONTH is not on the chart.");
        const active = world.store.get().tasks.filter((t) => t.start <= m && t.end >= m).length;
        api.print(monthPart(m), `:  ${active} task${active === 1 ? "" : "s"} active.`);
      },
    },
    {
      name: "Show Herald",
      global: true,
      run: (_a, api) => {
        api.print(
          B("Dynamic Windows Scheduler"),
          " — every bar, triangle and month header is a typed presentation; names printed here stay mouse-sensitive forever.",
        );
        api.print(
          "The lattice:  MILESTONE ⊂ TASK — TASK arguments accept milestones, but ",
          B("Slip Milestone"),
          " and ",
          B("Anchor End"),
          " demand a true MILESTONE.",
        );
        api.print(
          "Try: right-click a task → ",
          B("Move Task …"),
          " — the month headers grow dashed rings; click one to finish the command.",
        );
      },
    },
    {
      name: "Clear Listener",
      global: true,
      run: () => engine.transcript.clear(),
    },
  ]);

  const resolver: Resolver = {
    resolve: (ref) => {
      if ("value" in ref) return ref.value;
      if (ref.kind === "task") return world.task(ref.id);
      return undefined;
    },
  };

  const engine = new PbuiEngine<World>({
    ptypes,
    commands,
    world,
    resolver,
    idleDoc:
      "STS-31 Scheduler — hover any presentation; L: default action; Middle: Describe; R: menu; background R: global commands.",
  });
  return engine;
}

/* ----------------------------------- view ----------------------------------- */

function MonthCell({ i }: { i: number }) {
  const { m } = ymOf(i);
  return (
    <SvgPresentation
      type="month"
      object={valueRef(i)}
      label={fmtYM(i)}
      hitRect={{ x: mx(i) + 1, y: 25, width: MW - 2, height: HH - 24 }}
      style={{ cursor: "pointer" }}
    >
      <text x={mx(i) + MW / 2} y={39} textAnchor="middle" fontSize="11" fontWeight="bold" fill="var(--pbui-ink)">
        {MONTH_NAMES[m - 1]}
      </text>
    </SvgPresentation>
  );
}

function TaskRow({ task, idx }: { task: Task; idx: number }) {
  const y = HH + TITLE_H + 16 + idx * RH;
  const xs = mx(task.start);
  const xe = mx(task.end);
  const isMs = task.kind === "milestone";
  const labelX = (isMs ? xs + 10 : xe + 7) + task.depth * 8;
  const labelW = task.name.length * 6.9;
  const boxX = isMs ? xs - 8 : xs - 5;
  const boxW = Math.max(labelX + labelW + 6 - boxX, 20);
  return (
    <SvgPresentation
      type={ptypeOf(task)}
      object={taskRef(task)}
      label={task.name}
      hitRect={{ x: boxX, y: y - 10, width: boxW, height: 20 }}
      style={{ cursor: "pointer" }}
    >
      {isMs ? (
        <>
          <polygon points={`${xs},${y - 6} ${xs - 5},${y + 4} ${xs + 5},${y + 4}`} fill="var(--pbui-ink)" />
          <text x={labelX} y={y + 4} fontSize="11" fontStyle="italic" fill="var(--pbui-ink)">
            {task.name}
          </text>
        </>
      ) : (
        <>
          <line x1={xs} y1={y} x2={xe} y2={y} stroke="var(--pbui-ink)" strokeWidth="5" />
          <line x1={xs} y1={y - 5} x2={xs} y2={y + 5} stroke="var(--pbui-ink)" strokeWidth="1.5" />
          <line x1={xe} y1={y - 5} x2={xe} y2={y + 5} stroke="var(--pbui-ink)" strokeWidth="1.5" />
          <text x={labelX} y={y + 4} fontSize="11.5" fill="var(--pbui-ink)">
            {task.name}
          </text>
        </>
      )}
    </SvgPresentation>
  );
}

function GanttPane() {
  const engine = useEngine<World>();
  const { tasks } = useStore(engine.world.store);

  const chartW = mx(NM) + PAD_R;
  const chartH = HH + TITLE_H + tasks.length * RH + 26;

  const yearRuns: [number, number, number][] = [];
  {
    let i = 0;
    while (i < NM) {
      const y = ymOf(i).y;
      let j = i;
      while (j < NM && ymOf(j).y === y) j++;
      yearRuns.push([i, j, y]);
      i = j;
    }
  }

  return (
    <Pane
      title="STS-31 Payload Integration"
      subtitle={`Apr 1988 — Sep 1989, ${tasks.length} objects`}
      style={{ flex: 1, minWidth: 0 }}
      bodyStyle={{ padding: 0, overflow: "auto" }}
    >
      <svg width={chartW} height={chartH} style={{ display: "block", minWidth: "100%" }}>
        {/* frame + year header band */}
        <rect x={LM} y={2} width={mx(NM) - LM} height={chartH - 6} fill="none" stroke="var(--pbui-ink)" strokeWidth="3" />
        <rect x={LM} y={2} width={mx(NM) - LM} height={HH} fill="none" stroke="var(--pbui-ink)" strokeWidth="1.5" />
        {yearRuns.map(([a, b, y]) => (
          <g key={y}>
            <text x={(mx(a) + mx(b)) / 2} y={16} textAnchor="middle" fontSize="14" fontWeight="bold" fill="var(--pbui-ink)">
              {y}
            </text>
            <line x1={mx(b)} y1={2} x2={mx(b)} y2={chartH - 4} stroke="var(--pbui-ink)" strokeWidth="2" />
          </g>
        ))}
        <line x1={LM} y1={24} x2={mx(NM)} y2={24} stroke="var(--pbui-ink)" strokeWidth="1" />

        {/* month grid */}
        {Array.from({ length: NM }, (_, i) => (
          <line
            key={i}
            x1={mx(i)}
            y1={HH + 2}
            x2={mx(i)}
            y2={chartH - 4}
            stroke="var(--pbui-ink)"
            strokeWidth="1"
            strokeDasharray="2,4"
            opacity={0.35}
          />
        ))}

        {/* month header cells — presentations of type MONTH */}
        {Array.from({ length: NM }, (_, i) => (
          <MonthCell key={i} i={i} />
        ))}

        {/* project title rule */}
        <line x1={LM + 8} y1={HH + 11} x2={mx(NM) / 2 - 34} y2={HH + 11} stroke="var(--pbui-ink)" strokeWidth="1.5" />
        <text x={mx(NM) / 2} y={HH + 14} textAnchor="middle" fontSize="11" fontStyle="italic" fill="var(--pbui-ink)">
          sts-31
        </text>
        <line x1={mx(NM) / 2 + 34} y1={HH + 11} x2={mx(NM) - 8} y2={HH + 11} stroke="var(--pbui-ink)" strokeWidth="1.5" />

        {/* task rows — presentations of type TASK / MILESTONE */}
        {tasks.map((task, idx) => (
          <TaskRow key={task.id} task={task} idx={idx} />
        ))}
      </svg>
    </Pane>
  );
}

function SchedulerApp({ engine }: { engine: PbuiEngine<World> }) {
  const surface = usePbuiSurface();
  const { tasks } = useStore(engine.world.store);

  const heraldRan = useRef(false);
  useEffect(() => {
    if (heraldRan.current) return; // StrictMode double-mount guard
    heraldRan.current = true;
    engine.startCommand("Show Herald");
  }, [engine]);

  return (
    <div className="pbui-root" style={{ height: "100vh", display: "flex", flexDirection: "column" }} {...surface}>
      <div className="demo-back"><a href="#">← demos</a></div>
      <div style={{ display: "flex", padding: 8, flex: 2, minHeight: 0 }}>
        <GanttPane />
      </div>
      <div style={{ display: "flex", padding: "0 8px 8px", flex: 1, minHeight: 150 }}>
        <Pane title="Listener" style={{ flex: 1 }} bodyStyle={{ padding: 0, display: "flex" }}>
          <Listener style={{ flex: 1 }} prompt="SCHED> " />
        </Pane>
      </div>
      <ContextMenuHost />
      <MouseDocBar right={`${tasks.length} objects under <sts-31>`} />
      <StatusLine user="david" pkg="SCHEDULER" host="STS-31" />
    </div>
  );
}

export default function SchedulerDemo() {
  const engine = useMemo(() => makeEngine(makeWorld()), []);
  return (
    <PbuiProvider engine={engine}>
      <SchedulerApp engine={engine} />
    </PbuiProvider>
  );
}

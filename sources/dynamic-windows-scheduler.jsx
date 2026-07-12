import React, { useState, useRef, useEffect, useCallback } from "react";

/* ================================================================
   DYNAMIC WINDOWS SCHEDULER — v2
   A React recreation of a Symbolics Genera / CLIM presentation-based
   Gantt scheduler, now with:

   * A PRESENTATION TYPE LATTICE:
        MILESTONE ⊂ TASK ⊂ OBJECT,   MONTH ⊂ OBJECT
     A context accepting TASK also accepts MILESTONEs (subtype).
     A context accepting MILESTONE lights up ONLY the triangles.
     A context accepting MONTH makes the calendar header sensitive
     and every task bar insensitive.

   * MULTI-ARGUMENT COMMANDS exercising sequential input contexts:
        Combine Tasks   (task-a, task-b≠a)   -> merge spans
        Swap Spans      (task-a, task-b≠a)   -> exchange time spans
        Move Task       (task, month)        -> slide, keep duration
        Link Tasks      (predecessor, successor≠) -> finish-to-start
        Anchor End      (task, milestone)    -> pin end to a milestone
        Slip Milestone  (milestone, month)   -> milestone-only arg!
     Each argument is supplied by clicking any matching presentation
     — on the chart OR in the interactor scrollback. Right-clicking a
     task seeds these as PARTIAL COMMANDS (arg 1 pre-filled, the
     context opens for the rest).

   * Gestures everywhere:  L = look/modify, Middle = inspect
     (prints the type lattice), R = "Select action for <task>" menu,
     whose items differ by presentation type (milestones get
     "slip to month…", "convert to task").
   ================================================================ */

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const ORIGIN_Y = 1988, ORIGIN_M = 4, NM = 18;         // Apr 1988 .. Sep 1989
const MW = 58, LM = 14, HH = 46, TITLE_H = 18, RH = 23, PAD_R = 260;
const mx = (i) => LM + i * MW;
const ymOf = (i) => { const t = ORIGIN_M - 1 + i; return { y: ORIGIN_Y + Math.floor(t / 12), m: (t % 12) + 1 }; };
const fmtYM = (i) => { const { y, m } = ymOf(i); return `${MONTH_NAMES[m - 1]} ${y}`; };
const ymIndex = (y, m) => (y - ORIGIN_Y) * 12 + (m - ORIGIN_M);
const clampMonth = (i) => Math.max(0, Math.min(NM - 1, i));

/* ---------- presentation type lattice ---------- */
const PTYPE_PARENT = { milestone: "task", task: "object", month: "object", command: "object" };
const typep = (t, want) => { while (t) { if (t === want) return true; t = PTYPE_PARENT[t]; } return false; };
const lattice = (t) => {
  const chain = [t];
  while (PTYPE_PARENT[t]) { t = PTYPE_PARENT[t]; chain.push(t); }
  return chain.map((x) => x.toUpperCase()).join(" ⊂ ");
};
const ptypeOf = (task) => (task.kind === "milestone" ? "milestone" : "task");

let __id = 100;
const T = (name, start, end, kind = "task", depth = 0) => ({ id: "t" + __id++, name, start, end, kind, depth });

const sampleTasks = () => {
  __id = 100;
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
};

/* Interactor line parts */
const S = (v) => ({ t: "s", v });
const B = (v) => ({ t: "b", v });
const TASKREF = (id, name) => ({ t: "task", id, name });

export default function DynamicWindowsScheduler() {
  const [tasks, setTasks] = useState(sampleTasks);
  const [hover, setHover] = useState(null);        // {doc, taskId?}
  const [ctx, setCtx] = useState(null);            // {verb, specs, values, run}
  const [popup, setPopup] = useState(null);        // {x, y, taskId}
  const [dialog, setDialog] = useState(null);
  const [lines, setLines] = useState(() => [
    [B("Dynamic Windows Scheduler"), S("  — every object on this screen is a typed presentation.")],
    [S("Gestures:  "), B("L"), S(": look/modify   "), B("Middle"), S(": inspect (shows the type lattice)   "), B("R"), S(": menu of actions.")],
    [S("Try a two-argument verb:  type "), B("Combine Tasks"), S(" or "), B("Move Task"), S(", or right-click a bar → "), B("combine with task…")],
    [S("Type "), B("Help"), S(" for the full command set.  Names printed here stay mouse-sensitive forever.")],
  ]);
  const [cmd, setCmd] = useState("");
  const [grid, setGrid] = useState(true);
  const [clock, setClock] = useState(new Date());
  const chartRef = useRef(null);
  const interRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const el = interRef.current; if (el) el.scrollTop = el.scrollHeight; }, [lines, ctx]);

  const say = useCallback((...parts) => {
    setLines((ls) => [...ls, parts.map((p) => (typeof p === "string" ? S(p) : p))]);
  }, []);

  const taskById = useCallback((id) => tasks.find((t) => t.id === id), [tasks]);

  /* ================================================================
     INPUT CONTEXT MACHINERY — sequential typed argument acceptance
     ================================================================ */
  const curSpec = ctx ? ctx.specs[ctx.values.length] : null;
  const acceptableNow = (ptype) => (!ctx ? true : typep(ptype, curSpec.type));

  const startCmd = useCallback((verb, specs, run, preset = []) => {
    setPopup(null); setDialog(null);
    setCtx({ verb, specs, values: preset, run });
    const next = specs[preset.length];
    const echo = [B(verb)];
    preset.forEach((v, i) => echo.push(S(`  ⟨${specs[i].name}⟩ = `), v.ptype === "month" ? B(v.label) : TASKREF(v.obj.id, v.obj.name)));
    echo.push(S(`  — select a ${next.type.toUpperCase()} for ⟨${next.name}⟩…  (Esc aborts)`));
    setLines((ls) => [...ls, echo]);
  }, []);

  const acceptPres = (ptype, obj, label) => {
    const spec = ctx.specs[ctx.values.length];
    if (!typep(ptype, spec.type)) {
      say(`Not acceptable:  that is a ${ptype.toUpperCase()};  ${ctx.verb} needs a ${spec.type.toUpperCase()} for ⟨${spec.name}⟩.`);
      return;
    }
    if (spec.distinct && ctx.values.some((v) => v.ptype !== "month" && v.obj.id === obj.id)) {
      say(`⟨${spec.name}⟩ must be a different task.`);
      return;
    }
    const values = [...ctx.values, { ptype, obj, label }];
    say(S(`  ⟨${spec.name}⟩ => `), ptype === "month" ? B(label) : TASKREF(obj.id, obj.name));
    if (values.length < ctx.specs.length) {
      const nx = ctx.specs[values.length];
      setCtx({ ...ctx, values });
      say(S(`  now select a ${nx.type.toUpperCase()} for ⟨${nx.name}⟩…`));
    } else {
      const c = ctx; setCtx(null);
      c.run(values);
    }
  };

  const abortAll = useCallback(() => {
    if (popup) setPopup(null);
    else if (dialog) setDialog(null);
    else if (ctx) { setCtx(null); say(B("Aborted."), "  " + ctx.verb + " cancelled."); }
  }, [popup, dialog, ctx, say]);

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") abortAll(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [abortAll]);

  /* ================================================================
     COMMAND IMPLEMENTATIONS
     ================================================================ */
  const fieldsFrom = (i) => { const { y, m } = ymOf(i); return { y: String(y), m: String(m) }; };
  const openModify = (task) => setDialog({
    mode: "modify", taskId: task.id,
    fields: { name: task.name, kind: task.kind, s: fieldsFrom(task.start), e: fieldsFrom(task.end) },
  });
  const openCreate = (insert = null, depth = 0, base = null) => setDialog({
    mode: "create", insert, depth,
    fields: { name: "new-task", kind: "task", s: fieldsFrom(base ? base.start : 0), e: fieldsFrom(base ? base.end : 1) },
  });

  const inspect = (task) => {
    say(TASKREF(task.id, task.name), `  is a ${lattice(ptypeOf(task))}`);
    say(S(`    span ${fmtYM(task.start)} — ${fmtYM(task.end)}  (${task.end - task.start} month${task.end - task.start === 1 ? "" : "s"}), depth ${task.depth}.`));
  };

  const deleteTask = (task) => {
    setTasks((ts) => ts.filter((t) => t.id !== task.id));
    say("Deleted ", B(task.name), ".");
  };

  const insertRelative = (newTask, refId, where) => {
    setTasks((ts) => {
      const i = ts.findIndex((t) => t.id === refId);
      if (i < 0) return [...ts, newTask];
      const j = where === "after" ? i + 1 : i;
      return [...ts.slice(0, j), newTask, ...ts.slice(j)];
    });
  };

  const addMilestone = (task, which) => {
    const at = which === "start" ? task.start : task.end;
    const nt = T(`${which} ${task.name}`, at, at, "milestone", task.depth);
    insertRelative(nt, task.id, which === "start" ? "before" : "after");
    say("Added ", which, " milestone for ", TASKREF(task.id, task.name), " at ", fmtYM(at), ".");
  };

  const scheduleAll = () => {
    setTasks((ts) => [...ts].sort((a, b) => a.start - b.start || a.end - b.end));
    say(B("Schedule all"), ":  tasks re-sorted by start time.");
  };

  const enforceConstraints = () => {
    let fixed = 0;
    setTasks((ts) => ts.map((t) => {
      const s = clampMonth(t.start), e = Math.max(s, clampMonth(t.end));
      if (s !== t.start || e !== t.end) fixed++;
      return { ...t, start: s, end: e };
    }));
    say(B("Enforce constraints"), `:  ${fixed} task${fixed === 1 ? "" : "s"} adjusted; all constraints satisfied.`);
  };

  const reportOne = (task) => say(
    S("  "), TASKREF(task.id, task.name),
    S(`  ${task.kind === "milestone" ? "△" : "▬"}  ${fmtYM(task.start)} → ${fmtYM(task.end)}  [${task.end - task.start} mo]`)
  );
  const reportAll = () => { say(B("Report all"), ` — ${tasks.length} objects under <sts-31>:`); tasks.forEach(reportOne); };

  const convertKind = (task) => {
    if (task.kind === "milestone") {
      setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, kind: "task", end: clampMonth(t.start + 1) } : t)));
      say("Converted ", TASKREF(task.id, task.name), " to a TASK (given a 1-month span).");
    } else {
      setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, kind: "milestone", end: t.start } : t)));
      say("Converted ", TASKREF(task.id, task.name), " to a MILESTONE at ", fmtYM(task.start), ".");
    }
  };

  /* ---------- multi-argument verbs ---------- */
  const combine = (v) => {
    const a = taskById(v[0].obj.id), b = taskById(v[1].obj.id);
    if (!a || !b) { say("A participant vanished — presentation was stale."); return; }
    const s = Math.min(a.start, b.start), e = Math.max(a.end, b.end);
    const name = `${a.name} + ${b.name}`;
    setTasks((ts) => ts.filter((t) => t.id !== b.id)
      .map((t) => (t.id === a.id ? { ...t, name, kind: "task", start: s, end: e } : t)));
    say(B("Combined"), " into ", TASKREF(a.id, name), ` spanning ${fmtYM(s)} — ${fmtYM(e)}.`);
  };

  const swapSpans = (v) => {
    const a = taskById(v[0].obj.id), b = taskById(v[1].obj.id);
    if (!a || !b) { say("A participant vanished — presentation was stale."); return; }
    setTasks((ts) => ts.map((t) =>
      t.id === a.id ? { ...t, start: b.start, end: b.end }
      : t.id === b.id ? { ...t, start: a.start, end: a.end } : t));
    say(B("Swapped spans"), ":  ", TASKREF(a.id, a.name), " ⇄ ", TASKREF(b.id, b.name), ".");
  };

  const moveTask = (v) => {
    const a = taskById(v[0].obj.id); const m = v[1].obj;
    if (!a) { say("Task vanished — presentation was stale."); return; }
    const dur = a.end - a.start;
    const ns = Math.max(0, Math.min(m, NM - 1 - dur));
    setTasks((ts) => ts.map((t) => (t.id === a.id ? { ...t, start: ns, end: ns + dur } : t)));
    say(B("Moved"), " ", TASKREF(a.id, a.name), ` to ${fmtYM(ns)} — ${fmtYM(ns + dur)} (duration preserved${ns !== m ? ", clamped to the chart" : ""}).`);
  };

  const linkTasks = (v) => {
    const p = taskById(v[0].obj.id), s = taskById(v[1].obj.id);
    if (!p || !s) { say("A participant vanished — presentation was stale."); return; }
    const dur = s.end - s.start;
    const ns = Math.max(0, Math.min(p.end, NM - 1 - dur));
    setTasks((ts) => ts.map((t) => (t.id === s.id ? { ...t, start: ns, end: ns + dur } : t)));
    say(B("Linked"), " finish-to-start:  ", TASKREF(s.id, s.name), " now begins at ", fmtYM(ns), " when ", TASKREF(p.id, p.name), " ends.");
  };

  const anchorEnd = (v) => {
    const a = taskById(v[0].obj.id), ms = taskById(v[1].obj.id);
    if (!a || !ms) { say("A participant vanished — presentation was stale."); return; }
    const ne = ms.start, nsStart = Math.min(a.start, ne);
    setTasks((ts) => ts.map((t) => (t.id === a.id ? { ...t, start: nsStart, end: ne } : t)));
    say(B("Anchored"), ":  end of ", TASKREF(a.id, a.name), " pinned to milestone ", TASKREF(ms.id, ms.name), ` (${fmtYM(ne)}).`);
  };

  const slipMilestone = (v) => {
    const ms = taskById(v[0].obj.id); const m = v[1].obj;
    if (!ms) { say("Milestone vanished — presentation was stale."); return; }
    setTasks((ts) => ts.map((t) => (t.id === ms.id ? { ...t, start: m, end: m } : t)));
    say(B("Slipped"), " milestone ", TASKREF(ms.id, ms.name), " to ", fmtYM(m), ".");
  };

  /* command table: verb, argument specs, body */
  const VERBS = {
    "Combine Tasks":  { specs: [{ name: "task-a", type: "task" }, { name: "task-b", type: "task", distinct: true }], run: combine },
    "Swap Spans":     { specs: [{ name: "task-a", type: "task" }, { name: "task-b", type: "task", distinct: true }], run: swapSpans },
    "Move Task":      { specs: [{ name: "task", type: "task" }, { name: "new-start", type: "month" }], run: moveTask },
    "Link Tasks":     { specs: [{ name: "predecessor", type: "task" }, { name: "successor", type: "task", distinct: true }], run: linkTasks },
    "Anchor End":     { specs: [{ name: "task", type: "task" }, { name: "to-milestone", type: "milestone" }], run: anchorEnd },
    "Slip Milestone": { specs: [{ name: "milestone", type: "milestone" }, { name: "to-month", type: "month" }], run: slipMilestone },
  };
  const startVerb = (verb, preset = []) => startCmd(verb, VERBS[verb].specs, VERBS[verb].run, preset);

  /* ================================================================
     THE UNIVERSAL GESTURE TRANSLATOR
     ================================================================ */
  const onPres = (e, ptype, obj, label) => {
    e.preventDefault(); e.stopPropagation();
    if (ctx) {
      if (e.type === "click" && e.button === 0) acceptPres(ptype, obj, label);
      else say("(In an input context —  L selects,  Esc aborts.)");
      return;
    }
    if (ptype === "month") {
      if (e.type === "click") {
        const active = tasks.filter((t) => t.start <= obj && t.end >= obj).length;
        say(B(label), `:  ${active} task${active === 1 ? "" : "s"} active.`);
      }
      return;
    }
    const task = taskById(obj.id);
    if (!task) { say("That object no longer exists (its presentation is stale)."); return; }
    if (e.type === "contextmenu") setPopup({ x: e.clientX, y: e.clientY, taskId: task.id });
    else if (e.type === "auxclick" && e.button === 1) inspect(task);
    else if (e.button === 0) openModify(task);
  };

  const hoverDocFor = (ptype, label) => {
    if (ctx) {
      return acceptableNow(ptype)
        ? `⟨${curSpec.name}⟩ of ${ctx.verb} —  L: use ${label}    Esc: abort`
        : `${ptype.toUpperCase()} ${label} —  not acceptable (${ctx.verb} wants a ${curSpec.type.toUpperCase()} for ⟨${curSpec.name}⟩)`;
    }
    if (ptype === "month") return `MONTH ${label} —  L: count active tasks`;
    return `${lattice(ptype)}  ${label} —  L: Look/Modify    Middle: Inspect    R: Menu of actions`;
  };

  const taskPresProps = (id) => {
    const task = taskById(id);
    const ptype = task ? ptypeOf(task) : "task";
    return {
      onClick: (e) => onPres(e, ptype, task || { id }, task ? task.name : "?"),
      onAuxClick: (e) => onPres(e, ptype, task || { id }, task ? task.name : "?"),
      onContextMenu: (e) => onPres(e, ptype, task || { id }, task ? task.name : "?"),
      onMouseDown: (e) => { if (e.button === 1) e.preventDefault(); },
      onMouseEnter: () => setHover({ taskId: id, doc: task ? hoverDocFor(ptype, task.name) : "TASK (deleted) — its presentation is stale" }),
      onMouseLeave: () => setHover(null),
    };
  };

  /* ================================================================
     FUNCTION KEYS + TYPED COMMANDS
     ================================================================ */
  const guarded = (fn) => () => { if (ctx) { say("(Finish or Esc the pending ", B(ctx.verb), " first.)"); return; } fn(); };
  const scrollChart = (dx, dy) => { const el = chartRef.current; if (el) el.scrollBy({ left: dx, top: dy, behavior: "smooth" }); };
  const FKEYS = [
    ["RESHAPE", "Pick a task, then adjust its span", () => startCmd("Reshape", [{ name: "task", type: "task" }], (v) => { const t = taskById(v[0].obj.id); if (t) openModify(t); })],
    ["CREATE", "Create a new top-level task", () => openCreate(null, 0, null)],
    ["COMBINE", "Merge two tasks into one span", () => startVerb("Combine Tasks")],
    ["MOVE", "Slide a task to a new month", () => startVerb("Move Task")],
    ["LINK", "Chain successor after predecessor", () => startVerb("Link Tasks")],
    ["OPTIONS", "Toggle the month grid", () => { setGrid((g) => !g); say("Grid ", grid ? "off." : "on."); }],
    ["REFRESH", "Redisplay the chart", () => say("Redisplaying… all output records regenerated.")],
    ["SAVE", "Save the schedule", () => say("Schedule saved to FEP0:>pierce>sts-31.schedule.newest")],
    ["LOAD", "Load a schedule", () => say("Load: FEP0:>pierce>sts-31.schedule.newest already current.")],
    ["LEFT", "Scroll chart left", () => scrollChart(-MW * 3, 0)],
    ["RIGHT", "Scroll chart right", () => scrollChart(MW * 3, 0)],
    ["UP", "Scroll chart up", () => scrollChart(0, -RH * 4)],
    ["DOWN", "Scroll chart down", () => scrollChart(0, RH * 4)],
    ["INIT", "Restore the sample schedule", () => { setTasks(sampleTasks()); say(B("Init"), ":  sample STS-31 schedule restored."); }],
    ["EXIT", "Leave the activity", () => say(B("Exit"), ":  this console stays resident.")],
  ];

  const TYPED = [
    ["Create Task", () => openCreate(null, 0, null)],
    ["Modify Task", () => startCmd("Modify Task", [{ name: "task", type: "task" }], (v) => { const t = taskById(v[0].obj.id); if (t) openModify(t); })],
    ["Inspect Task", () => startCmd("Inspect Task", [{ name: "task", type: "task" }], (v) => { const t = taskById(v[0].obj.id); if (t) inspect(t); })],
    ["Delete Task", () => startCmd("Delete Task", [{ name: "task", type: "task" }], (v) => { const t = taskById(v[0].obj.id); if (t) deleteTask(t); })],
    ["Combine Tasks", () => startVerb("Combine Tasks")],
    ["Swap Spans", () => startVerb("Swap Spans")],
    ["Move Task", () => startVerb("Move Task")],
    ["Link Tasks", () => startVerb("Link Tasks")],
    ["Anchor End", () => startVerb("Anchor End")],
    ["Slip Milestone", () => startVerb("Slip Milestone")],
    ["Report All", reportAll],
    ["Schedule All", scheduleAll],
    ["Enforce Constraints", enforceConstraints],
    ["Clear", () => setLines([])],
    ["Help", () => {
      say(B("Commands"), ":  " + TYPED.map(([n]) => n).join(",  "));
      say("Multi-argument verbs open sequential input contexts — only presentations of the wanted TYPE are sensitive.");
      say("MILESTONE ⊂ TASK, so milestones satisfy TASK arguments; but ", B("Slip Milestone"), " and ", B("Anchor End"), " demand a true MILESTONE.");
    }],
  ];

  const submitCmd = () => {
    const q = cmd.trim().toLowerCase();
    setCmd("");
    if (!q) return;
    const hits = TYPED.filter(([n]) => n.toLowerCase().startsWith(q));
    if (hits.length === 1 || (hits.length && hits[0][0].toLowerCase() === q)) {
      say(S("Command: "), B(hits[0][0]));
      hits[0][1]();
    } else if (hits.length > 1) {
      say(`"${cmd.trim()}" is ambiguous:  ` + hits.map(([n]) => n).join(", "));
    } else {
      say(`Unknown command "${cmd.trim()}".  Type `, B("Help"), ".");
    }
  };
  const completeCmd = () => {
    const q = cmd.trim().toLowerCase();
    if (!q) return;
    const hits = TYPED.filter(([n]) => n.toLowerCase().startsWith(q));
    if (hits.length >= 1) setCmd(hits[0][0]);
  };

  /* ================================================================
     POPUP MENU — items vary by presentation type (translator lookup)
     ================================================================ */
  const popupItemsFor = (task) => {
    const partial = (verb) => () => startVerb(verb, [{ ptype: ptypeOf(task), obj: task, label: task.name }]);
    const base = [
      ["look or modify", () => openModify(task)],
      ["add sub task", () => openCreate({ where: "after", refId: task.id }, task.depth + 1, task)],
      ["add after", () => openCreate({ where: "after", refId: task.id }, task.depth, task)],
      ["add before", () => openCreate({ where: "before", refId: task.id }, task.depth, task)],
      ["add start milestone", () => addMilestone(task, "start")],
      ["add end milestone", () => addMilestone(task, "end")],
      ["combine with task …", partial("Combine Tasks")],
      ["swap spans with …", partial("Swap Spans")],
      ["move to month …", partial("Move Task")],
      ["link successor …", partial("Link Tasks")],
      ["inspect", () => inspect(task)],
      ["send message", () => say("Message queued for PIERCE regarding ", TASKREF(task.id, task.name), ".")],
      ["resources", () => say("Resources for ", TASKREF(task.id, task.name), ":  crew 4, GSE bay 2, freon cart 1.")],
      ["delete task", () => deleteTask(task)],
      ["ground rules", () => say(B("Ground rules"), ":  sub tasks fall within the parent envelope; milestones have zero duration.")],
      ["schedule all", scheduleAll],
      ["save schedule", () => say("Schedule saved to FEP0:>pierce>sts-31.schedule.newest")],
      ["re-calculate duration", () => say(TASKREF(task.id, task.name), `:  duration ${task.end - task.start} month${task.end - task.start === 1 ? "" : "s"}.`)],
      ["enforce constraints", enforceConstraints],
      ["report", () => reportOne(task)],
      ["report all", reportAll],
    ];
    /* type-specific translators */
    if (task.kind === "milestone") {
      base.splice(10, 0,
        ["slip to month …", partial("Slip Milestone")],
        ["convert to task", () => convertKind(task)]);
    } else {
      base.splice(10, 0,
        ["anchor end to milestone …", partial("Anchor End")],
        ["convert to milestone", () => convertKind(task)]);
    }
    return base;
  };

  /* ================================================================
     DIALOG
     ================================================================ */
  const applyDialog = () => {
    const d = dialog; if (!d) return;
    const f = d.fields;
    const name = f.name.trim() || "unnamed-task";
    const si = clampMonth(ymIndex(parseInt(f.s.y) || ORIGIN_Y, parseInt(f.s.m) || 1));
    const ei = Math.max(si, clampMonth(ymIndex(parseInt(f.e.y) || ORIGIN_Y, parseInt(f.e.m) || 1)));
    if (d.mode === "modify") {
      setTasks((ts) => ts.map((t) => (t.id === d.taskId ? { ...t, name, kind: f.kind, start: si, end: f.kind === "milestone" ? si : ei } : t)));
      say("Modified ", TASKREF(d.taskId, name), `:  ${f.kind}, ${fmtYM(si)} — ${fmtYM(f.kind === "milestone" ? si : ei)}.`);
    } else {
      const nt = { ...T(name, si, f.kind === "milestone" ? si : ei, f.kind, d.depth || 0) };
      if (d.insert) insertRelative(nt, d.insert.refId, d.insert.where);
      else setTasks((ts) => [...ts, nt]);
      say("Created ", TASKREF(nt.id, nt.name), `:  ${f.kind}, ${fmtYM(nt.start)} — ${fmtYM(nt.end)}.`);
    }
    setDialog(null);
  };
  const setField = (path, v) => setDialog((d) => {
    const f = { ...d.fields };
    if (path === "name") f.name = v;
    else if (path === "kind") f.kind = v;
    else { const [k, p] = path; f[k] = { ...f[k], [p]: v }; }
    return { ...d, fields: f };
  });

  /* ================================================================
     POINTER DOC + STATUS
     ================================================================ */
  const pointerDoc = popup
    ? "Menu Choose —  L: execute item    Esc: abort"
    : dialog
      ? "Accepting Values —  L on <kind>: cycle values    Enter: OK    Esc: abort"
      : ctx
        ? (hover ? hover.doc : `Accepting arg ${ctx.values.length + 1}/${ctx.specs.length} — a ${curSpec.type.toUpperCase()} for ⟨${curSpec.name}⟩ of ${ctx.verb}.   L: supply    Esc: abort`)
        : hover
          ? hover.doc
          : "To see other commands, press Shift, Control, Meta-Shift, or Super.";

  const mode = popup ? "Menu Choose" : dialog ? "Accept Values"
    : ctx ? `Accept ${curSpec.type.toUpperCase()}` : "User Input";

  /* ================================================================
     CHART GEOMETRY
     ================================================================ */
  const chartW = mx(NM) + PAD_R;
  const chartH = HH + TITLE_H + tasks.length * RH + 26;
  const yearRuns = [];
  { let i = 0; while (i < NM) { const y = ymOf(i).y; let j = i; while (j < NM && ymOf(j).y === y) j++; yearRuns.push([i, j, y]); i = j; } }

  const popupTask = popup ? taskById(popup.taskId) : null;
  const monthAcceptable = ctx && typep("month", curSpec.type);

  /* prompt line contents during a context */
  const promptParts = ctx && (() => {
    const bits = [];
    ctx.specs.forEach((sp, i) => {
      if (i < ctx.values.length) bits.push(`(${sp.name}: ${ctx.values[i].label ?? ctx.values[i].obj.name})`);
      else if (i === ctx.values.length) bits.push(`(${sp.name}:`);
    });
    return bits.join("  ");
  })();

  return (
    <div className="dw-root" style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#fff", color: "#000" }}>
      <style>{`
        .dw-root, .dw-root * { font-family: "Courier New", ui-monospace, monospace; box-sizing: border-box; }
        .dw-root ::selection { background:#000; color:#fff; }
        .fkey { border:2px solid #000; background:#fff; padding:2px 8px; font-weight:bold; font-size:12px; cursor:pointer; user-select:none; white-space:nowrap; }
        .fkey:hover { background:#000; color:#fff; }
        .fkey:focus-visible, .pres-text:focus-visible { outline:2px dashed #000; outline-offset:2px; }
        .pres-text { cursor:pointer; text-decoration:underline; text-underline-offset:2px; }
        .pres-text:hover { background:#000; color:#fff; }
        .pres-text.ctx-ok { outline:1px dashed #555; }
        .pres-text.ctx-no { opacity:.4; cursor:not-allowed; text-decoration:none; }
        .menu-item { padding:1px 10px; text-align:center; cursor:pointer; font-size:12px; white-space:nowrap; }
        .menu-item:hover { background:#000; color:#fff; }
        .dw-field { border:none; border-bottom:1px solid #000; font-size:13px; padding:1px 2px; width:100%; background:#fff; color:#000; }
        .dw-field:focus { outline:none; background:#eee; }
        svg text { user-select:none; }
        @media (prefers-reduced-motion: reduce) { .dw-root * { scroll-behavior:auto !important; animation:none !important; } }
      `}</style>

      {/* ============ CHART PANE ============ */}
      <div ref={chartRef} style={{ flex: 1, overflow: "auto", borderBottom: "3px solid #000", cursor: ctx ? "crosshair" : "default" }}>
        <svg width={chartW} height={chartH} style={{ display: "block", minWidth: "100%" }}>
          <rect x={LM} y={2} width={mx(NM) - LM} height={chartH - 6} fill="none" stroke="#000" strokeWidth="3" />
          <rect x={LM} y={2} width={mx(NM) - LM} height={HH} fill="#f2f2f2" stroke="#000" strokeWidth="1.5" />
          {yearRuns.map(([a, b, y]) => (
            <g key={y}>
              <text x={(mx(a) + mx(b)) / 2} y={16} textAnchor="middle" fontSize="14" fontWeight="bold">{y}</text>
              <line x1={mx(b)} y1={2} x2={mx(b)} y2={chartH - 4} stroke="#000" strokeWidth="2" />
            </g>
          ))}
          <line x1={LM} y1={24} x2={mx(NM)} y2={24} stroke="#000" strokeWidth="1" />

          {/* months — presentations of type MONTH */}
          {Array.from({ length: NM }, (_, i) => {
            const { m } = ymOf(i);
            const dim = ctx && !monthAcceptable;
            const hi = hover && hover.doc && hover.doc.startsWith("⟨") && hover.monthIdx === i;
            return (
              <g key={i} style={{ cursor: dim ? "not-allowed" : "pointer" }} opacity={dim ? 0.35 : 1}
                onMouseEnter={() => setHover({ monthIdx: i, doc: hoverDocFor("month", fmtYM(i)) })}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => onPres(e, "month", i, fmtYM(i))}>
                <rect x={mx(i) + 1} y={25} width={MW - 2} height={HH - 24} fill={hi ? "#000" : "transparent"} opacity={hi ? 0.12 : 1}
                  stroke={monthAcceptable ? "#000" : "none"} strokeWidth="1.5"
                  strokeDasharray={hi ? "none" : "3,3"} />
                <text x={mx(i) + MW / 2} y={39} textAnchor="middle" fontSize="11" fontWeight="bold">{MONTH_NAMES[m - 1]}</text>
                {grid && <line x1={mx(i)} y1={HH + 2} x2={mx(i)} y2={chartH - 4} stroke="#999" strokeWidth="1" strokeDasharray="2,4" />}
              </g>
            );
          })}

          <line x1={LM + 8} y1={HH + 11} x2={mx(NM) / 2 - 34} y2={HH + 11} stroke="#000" strokeWidth="1.5" />
          <text x={mx(NM) / 2} y={HH + 14} textAnchor="middle" fontSize="11" fontStyle="italic">sts-31</text>
          <line x1={mx(NM) / 2 + 34} y1={HH + 11} x2={mx(NM) - 8} y2={HH + 11} stroke="#000" strokeWidth="1.5" />

          {/* task rows — presentations of type TASK / MILESTONE */}
          {tasks.map((task, idx) => {
            const y = HH + TITLE_H + 16 + idx * RH;
            const xs = mx(task.start), xe = mx(task.end);
            const isMs = task.kind === "milestone";
            const okNow = acceptableNow(ptypeOf(task));
            const labelX = (isMs ? xs + 10 : xe + 7) + task.depth * 8;
            const labelW = task.name.length * 6.9;
            const hi = hover && hover.taskId === task.id && (!ctx || okNow);
            const boxX = (isMs ? xs - 8 : xs - 5);
            const boxW = labelX + labelW + 6 - boxX;
            return (
              <g key={task.id} {...taskPresProps(task.id)}
                style={{ cursor: ctx && !okNow ? "not-allowed" : "pointer" }}
                opacity={ctx && !okNow ? 0.3 : 1} tabIndex={-1}>
                <rect x={boxX} y={y - 10} width={Math.max(boxW, 20)} height={20} fill={hi ? "#000" : "transparent"} opacity={hi ? 0.07 : 1}
                  stroke={hi ? "#000" : ctx && okNow ? "#666" : "none"} strokeWidth={hi ? 2 : 1}
                  strokeDasharray={hi ? "none" : ctx && okNow ? "3,3" : "none"} />
                {isMs ? (
                  <>
                    <polygon points={`${xs},${y - 6} ${xs - 5},${y + 4} ${xs + 5},${y + 4}`} fill="#000" />
                    <text x={labelX} y={y + 4} fontSize="11" fontStyle="italic">{task.name}</text>
                  </>
                ) : (
                  <>
                    <line x1={xs} y1={y} x2={xe} y2={y} stroke="#000" strokeWidth="5" />
                    <line x1={xs} y1={y - 5} x2={xs} y2={y + 5} stroke="#000" strokeWidth="1.5" />
                    <line x1={xe} y1={y - 5} x2={xe} y2={y + 5} stroke="#000" strokeWidth="1.5" />
                    <text x={labelX} y={y + 4} fontSize="11.5">{task.name}</text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* ============ INTERACTOR ============ */}
      <div ref={interRef} onClick={() => inputRef.current && inputRef.current.focus()}
        style={{ height: 148, overflowY: "auto", padding: "4px 10px", fontSize: 12.5, lineHeight: "17px", borderBottom: "3px solid #000", background: "#fff" }}>
        {lines.map((parts, i) => (
          <div key={i} style={{ whiteSpace: "pre-wrap" }}>
            {parts.map((p, j) => {
              if (p.t === "b") return <b key={j}>{p.v}</b>;
              if (p.t !== "task") return <span key={j}>{p.v}</span>;
              const t = taskById(p.id);
              const okNow = t ? acceptableNow(ptypeOf(t)) : false;
              const cls = "pres-text" + (ctx ? (okNow ? " ctx-ok" : " ctx-no") : "");
              return (
                <span key={j} className={cls} {...taskPresProps(p.id)}>
                  {p.name}
                </span>
              );
            })}
          </div>
        ))}
        <div style={{ display: "flex", whiteSpace: "pre" }}>
          {ctx ? (
            <span>
              <b>{ctx.verb}</b>  {promptParts} <span style={{ background: "#000", color: "#000" }}>█</span>{")"}
              <i>  click a highlighted {curSpec.type.toUpperCase()}…</i>
            </span>
          ) : (
            <>
              <span>Command: </span>
              <input ref={inputRef} value={cmd} spellCheck={false} aria-label="Command input"
                onChange={(e) => setCmd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitCmd();
                  else if (e.key === "Tab") { e.preventDefault(); completeCmd(); }
                }}
                style={{ flex: 1, border: "none", outline: "none", font: "inherit", fontSize: 12.5, padding: 0, background: "transparent", color: "#000" }} />
            </>
          )}
        </div>
      </div>

      {/* ============ FUNCTION KEY STRIP ============ */}
      <div style={{ display: "flex", gap: 6, padding: "5px 8px", background: "#e8e8e8", borderBottom: "3px solid #000", overflowX: "auto" }}>
        {FKEYS.map(([label, doc, fn]) => (
          <button key={label} className="fkey" onClick={guarded(fn)}
            onMouseEnter={() => setHover({ doc: `COMMAND ${label} —  L: ${doc}` })}
            onMouseLeave={() => setHover(null)}>
            {label}
          </button>
        ))}
      </div>

      {/* ============ POINTER DOCUMENTATION ============ */}
      <div style={{ background: "#000", color: "#fff", fontSize: 12, padding: "3px 10px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {pointerDoc}
      </div>

      {/* ============ STATUS LINE ============ */}
      <div style={{ display: "flex", fontSize: 11.5, padding: "2px 10px", background: "#fff", gap: 30 }}>
        <span>[{clockStr(clock)}]</span>
        <span>pierce</span>
        <span>CL USER:</span>
        <span style={{ fontWeight: "bold" }}>{mode}</span>
      </div>

      {/* ============ POPUP: Select action for <task> ============ */}
      {popup && popupTask && (
        <div onClick={() => setPopup(null)} onContextMenu={(e) => { e.preventDefault(); setPopup(null); }}
          style={{ position: "fixed", inset: 0, zIndex: 40 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed", zIndex: 41,
              left: Math.min(popup.x, (typeof window !== "undefined" ? window.innerWidth : 900) - 320),
              top: Math.max(8, Math.min(popup.y, (typeof window !== "undefined" ? window.innerHeight : 700) - 480)),
              background: "#fff", border: "2px solid #000", boxShadow: "4px 4px 0 #000", minWidth: 280,
              maxHeight: "88vh", overflowY: "auto",
            }}>
            <div style={{ borderBottom: "2px solid #000", padding: "3px 10px", fontSize: 12, fontWeight: "bold", textAlign: "center" }}>
              Select action for &lt;{popupTask.name} of &lt;sts-31&gt;&gt;
              <div style={{ fontWeight: "normal", fontStyle: "italic", fontSize: 10.5 }}>{lattice(ptypeOf(popupTask))}</div>
            </div>
            {popupItemsFor(popupTask).map(([label, fn]) => (
              <div key={label} className="menu-item"
                onMouseEnter={() => setHover({ doc: `MENU ITEM ${label} —  L: apply to ${popupTask.name}${label.endsWith("…") ? "  (opens an input context for the remaining argument)" : ""}` })}
                onMouseLeave={() => setHover(null)}
                onClick={() => { setPopup(null); fn(); }}>
                {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============ ACCEPTING-VALUES DIALOG ============ */}
      {dialog && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(255,255,255,0.4)" }}
          onKeyDown={(e) => { if (e.key === "Enter") applyDialog(); }}>
          <div style={{
            position: "fixed", left: "50%", top: 90, transform: "translateX(-50%)", width: 400,
            background: "#fff", border: "2px solid #000", boxShadow: "5px 5px 0 #000", padding: 14, zIndex: 51,
          }}>
            <div style={{ fontWeight: "bold", fontSize: 13, borderBottom: "2px solid #000", paddingBottom: 5, marginBottom: 10 }}>
              {dialog.mode === "modify" ? `Modify <${dialog.fields.name}>` : "Create task"}
            </div>
            <table style={{ width: "100%", fontSize: 13, borderSpacing: "0 7px" }}>
              <tbody>
                <tr>
                  <td style={{ width: 130 }}>Name:</td>
                  <td><input className="dw-field" autoFocus value={dialog.fields.name} onChange={(e) => setField("name", e.target.value)} /></td>
                </tr>
                <tr>
                  <td>Kind:</td>
                  <td>
                    <span className="pres-text" role="button" tabIndex={0}
                      onMouseEnter={() => setHover({ doc: "MEMBER (task milestone) —  L: cycle possible values" })}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => setField("kind", dialog.fields.kind === "task" ? "milestone" : "task")}
                      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); setField("kind", dialog.fields.kind === "task" ? "milestone" : "task"); } }}>
                      {dialog.fields.kind}
                    </span>
                    <span style={{ fontSize: 11, color: "#555" }}>   (click to cycle)</span>
                  </td>
                </tr>
                <tr>
                  <td>Start (month/year):</td>
                  <td style={{ display: "flex", gap: 8 }}>
                    <input className="dw-field" style={{ width: 50 }} value={dialog.fields.s.m} onChange={(e) => setField(["s", "m"], e.target.value)} aria-label="Start month" />
                    <input className="dw-field" style={{ width: 80 }} value={dialog.fields.s.y} onChange={(e) => setField(["s", "y"], e.target.value)} aria-label="Start year" />
                  </td>
                </tr>
                {dialog.fields.kind !== "milestone" && (
                  <tr>
                    <td>End (month/year):</td>
                    <td style={{ display: "flex", gap: 8 }}>
                      <input className="dw-field" style={{ width: 50 }} value={dialog.fields.e.m} onChange={(e) => setField(["e", "m"], e.target.value)} aria-label="End month" />
                      <input className="dw-field" style={{ width: 80 }} value={dialog.fields.e.y} onChange={(e) => setField(["e", "y"], e.target.value)} aria-label="End year" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
              <button className="fkey" onClick={applyDialog}
                onMouseEnter={() => setHover({ doc: "COMMAND OK —  L: apply these values" })} onMouseLeave={() => setHover(null)}>
                &lt;OK&gt;
              </button>
              <button className="fkey" onClick={() => setDialog(null)}
                onMouseEnter={() => setHover({ doc: "COMMAND Abort —  L: discard these values" })} onMouseLeave={() => setHover(null)}>
                &lt;Abort&gt;
              </button>
            </div>
            <div style={{ fontSize: 10.5, color: "#555", marginTop: 8 }}>
              Range is clamped to Apr 1988 — Sep 1989.  Enter = OK,  Esc = Abort.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function clockStr(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

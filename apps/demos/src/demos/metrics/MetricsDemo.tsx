/* PRESENTA — Metrics II: port of sources/presentation-metrics.jsx onto PBUI.
 *
 * A Genera-style telemetry dashboard: 6 metrics × 3 nodes = 18 gauge dials,
 * a strip-chart viewport plotting selected histories, and 8 readout ports
 * wired to gauges by the classic two-click "Assign Port" command. Every
 * gauge, port and plotted-lane label is a typed presentation; left-click on
 * a gauge toggles plotting (Plot/Unplot both claim isDefaultFor "gauge" and
 * the first applicable one wins), left-click on a port starts Assign Port.
 *
 * Deviations from the original:
 * - The menubar (FILE/TELEM/PLOT/HELP) is subsumed by the background
 *   right-click global-command menu, per the PBUI shell conventions.
 * - The alarm event-log pane is dropped; alarm state still shows as hatched
 *   gauge cells and "!ALARM" flags in the viewport lane labels.
 * - "Set Metric Value" and "Inspect" are dropped; "Hardcopy Window" becomes
 *   "Hardcopy" (gauge → unicode sparkline of its history).
 * - The "window" ptype (viewport/listener panes as presentations) is
 *   omitted — no command consumed it after the Hardcopy re-targeting.
 * (No PORTING-GAPS: everything the port needed was expressible in PBUI.)
 */

import { useEffect, useMemo, useRef } from "react";
import {
  B,
  CommandTable,
  PbuiEngine,
  PTypes,
  defineBuiltinPtypes,
  valueRef,
  type ObjectRef,
  type Resolver,
} from "@go-go-golems/pbui-core";
import {
  PbuiProvider,
  Presentation,
  SvgPresentation,
  useEngine,
  usePbuiSurface,
} from "@go-go-golems/pbui-react";
import { ContextMenuHost, MouseDocBar, Pane, StatusLine } from "@go-go-golems/pbui-chrome";
import { Listener } from "@go-go-golems/pbui-listener";
import { Store, useStore } from "../../lib/store.js";

/* --------------------------------- domain ---------------------------------- */

const METRIC_ROWS = ["CPU-LOAD", "MEM-USED", "NET-IN", "NET-OUT", "DISK-IO", "TEMP"];
const NODES = ["NODE-A", "NODE-B", "NODE-C"];
const HISTORY = 90;
const N_PORTS = 8;
const TICK_MS = 650;

interface Gauge {
  id: string; // "CPU-LOAD@NODE-A"
  name: string;
  node: string;
  row: number;
  col: number;
  value: number; // 0..100
  peak: number;
  alarm: number; // 0..100
  history: number[]; // HISTORY samples
  plotted: boolean;
}

interface Port {
  id: string; // "PORT-3"
  index: number;
  gaugeId: string | null;
}

interface MetricsState {
  gauges: Gauge[];
  ports: Port[];
  paused: boolean;
  angle: number; // decorative wireframe cube rotation
  simTime: number; // seconds
}

function makeGauges(): Gauge[] {
  const g: Gauge[] = [];
  METRIC_ROWS.forEach((name, r) =>
    NODES.forEach((node, c) => {
      const base = 20 + ((r * 31 + c * 17) % 55);
      g.push({
        id: `${name}@${node}`,
        name,
        node,
        row: r,
        col: c,
        value: base,
        peak: base,
        alarm: 85,
        history: Array.from({ length: HISTORY }, () => base),
        plotted: r === 0 && c === 0, // start with one plotted
      });
    }),
  );
  return g;
}

function seedState(): MetricsState {
  return {
    gauges: makeGauges(),
    ports: Array.from({ length: N_PORTS }, (_, i) => ({
      id: `PORT-${i}`,
      index: i,
      gaugeId: null,
    })),
    paused: false,
    angle: 0,
    simTime: 0,
  };
}

/* random-walk step, drift/pull/spike math from presentation-metrics.jsx:42-50 */
function stepGauge(g: Gauge): Gauge {
  const drift = (Math.random() - 0.5) * 9;
  const pull = (45 + g.row * 7 - g.value) * 0.03;
  const spike = Math.random() < 0.012 ? Math.random() * 35 : 0;
  const v = Math.max(0, Math.min(100, g.value + drift + pull + spike));
  return { ...g, value: v, peak: Math.max(g.peak, v), history: [...g.history.slice(1), v] };
}

function tick(s: MetricsState): MetricsState {
  return {
    ...s,
    angle: s.angle + 0.03,
    simTime: s.paused ? s.simTime : s.simTime + TICK_MS / 1000,
    gauges: s.paused ? s.gauges : s.gauges.map(stepGauge),
  };
}

/* --------------------------------- helpers --------------------------------- */

/* pie wedge showing value 0..100, from presentation-metrics.jsx:132-140 */
function wedgePath(cx: number, cy: number, r: number, frac: number): string {
  if (frac <= 0.002) return "";
  if (frac >= 0.998) frac = 0.998;
  const a0 = -Math.PI / 2;
  const a1 = a0 + frac * 2 * Math.PI;
  const large = frac > 0.5 ? 1 : 0;
  return `M ${cx} ${cy} L ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)}
          A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} Z`;
}

const SPARK = "▁▂▃▄▅▆▇█";
function sparkline(history: number[]): string {
  let out = "";
  for (let i = 0; i < history.length; i += 2) {
    const v = history[i]!;
    out += SPARK[Math.max(0, Math.min(7, Math.floor((v / 100) * 8)))]!;
  }
  return out;
}

/* decorative rotating wireframe cube, from presentation-metrics.jsx:695-708 */
function cubeEdges(angle: number, w: number): Array<[[number, number], [number, number]]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? 1 : -1;
    const y = i & 2 ? 1 : -1;
    const z = i & 4 ? 1 : -1;
    const c = Math.cos(angle), s = Math.sin(angle);
    const c2 = Math.cos(angle * 0.7), s2 = Math.sin(angle * 0.7);
    const X = x * c - z * s;
    let Z = x * s + z * c;
    const Y = y * c2 - Z * s2;
    Z = y * s2 + Z * c2;
    const d = 3.4 / (Z + 3.4 + 1.2);
    pts.push([w - 92 + X * 52 * d, 84 + Y * 52 * d]);
  }
  const edges: Array<[number, number]> = [
    [0, 1], [1, 3], [3, 2], [2, 0],
    [4, 5], [5, 7], [7, 6], [6, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  return edges.map(([a, b]) => [pts[a]!, pts[b]!]);
}

/* --------------------------------- engine ---------------------------------- */

interface World {
  store: Store<MetricsState>;
  gauge(id: string): Gauge | undefined;
  port(id: string): Port | undefined;
}

function makeWorld(): World {
  const store = new Store(seedState());
  return {
    store,
    gauge: (id) => store.get().gauges.find((g) => g.id === id),
    port: (id) => store.get().ports.find((p) => p.id === id),
  };
}

const gaugeRef = (g: Gauge): ObjectRef => ({ kind: "gauge", id: g.id });
const portRef = (p: Port): ObjectRef => ({ kind: "port", id: p.id });
const gaugePart = (g: Gauge) =>
  ({ t: "pres", type: "gauge", ref: gaugeRef(g), label: g.id }) as const;
const portPart = (p: Port) =>
  ({ t: "pres", type: "port", ref: portRef(p), label: p.id }) as const;

function makeEngine(world: World) {
  const ptypes = new PTypes<World>();
  defineBuiltinPtypes(ptypes);

  ptypes.define<Gauge>({
    name: "gauge",
    print: (g) => `#<GAUGE ${g.id} ${g.value.toFixed(1)}>`,
    describe: (g) => [
      B(`#<GAUGE ${g.id} ${g.value.toFixed(1)}>`),
      `  A telemetry channel of class METRIC-GAUGE.`,
      `  Current value ${g.value.toFixed(1)}, peak ${g.peak.toFixed(1)}, alarm at ${g.alarm}.`,
      `  ${g.plotted ? "Currently plotted in the viewport." : "Not plotted."}`,
    ],
    parse: (text, w) => {
      const t = text.trim().toUpperCase();
      if (!t) return { ok: false, err: "empty GAUGE name" };
      for (const g of w.store.get().gauges)
        if (g.id === t || g.id.startsWith(t))
          return { ok: true, value: g, ref: gaugeRef(g), label: g.id };
      return { ok: false, err: `${text} does not name a GAUGE` };
    },
  });

  ptypes.define<Port>({
    name: "port",
    print: (p) => `#<PORT ${p.index}>`,
    describe: (p, w) => [
      B(`#<PORT ${p.index}>`),
      p.gaugeId
        ? `  Readout port wired to ${p.gaugeId} (currently ${w.gauge(p.gaugeId)?.value.toFixed(1) ?? "?"}).`
        : `  Readout port, unconnected.  "No Port".`,
    ],
    parse: (text, w) => {
      const t = text.trim().toUpperCase();
      if (!t) return { ok: false, err: "empty PORT name" };
      const norm = /^\d+$/.test(t) ? `PORT-${t}` : t;
      for (const p of w.store.get().ports)
        if (p.id === norm || p.id.startsWith(norm))
          return { ok: true, value: p, ref: portRef(p), label: p.id };
      return { ok: false, err: `${text} does not name a PORT` };
    },
  });

  const commands = new CommandTable<World>();
  const resolveGauge = (ref: ObjectRef): Gauge | undefined =>
    "id" in ref ? world.gauge(ref.id) : undefined;
  const resolvePort = (ref: ObjectRef): Port | undefined =>
    "id" in ref ? world.port(ref.id) : undefined;

  commands.defineAll([
    /* Plot before Unplot: both are isDefaultFor "gauge" and the first
     * applicable command wins, so left-click toggles plotting. */
    {
      name: "Plot Gauge",
      doc: "Add a gauge's history to the strip-chart viewport.",
      args: [{ name: "gauge", type: "gauge" }],
      appliesTo: (pres) => resolveGauge(pres.ref)?.plotted === false,
      isDefaultFor: ["gauge"],
      run: (args, api) => {
        const g = api.resolve(args["gauge"]!) as Gauge | undefined;
        if (!g) return api.printErr("That gauge vanished — presentation was stale.");
        world.store.update((s) => ({
          ...s,
          gauges: s.gauges.map((x) => (x.id === g.id ? { ...x, plotted: true } : x)),
        }));
        api.print(gaugePart(g), " added to viewport plot.");
      },
    },
    {
      name: "Unplot Gauge",
      doc: "Remove a gauge from the strip-chart viewport.",
      args: [{ name: "gauge", type: "gauge" }],
      appliesTo: (pres) => resolveGauge(pres.ref)?.plotted === true,
      isDefaultFor: ["gauge"],
      run: (args, api) => {
        const g = api.resolve(args["gauge"]!) as Gauge | undefined;
        if (!g) return api.printErr("That gauge vanished — presentation was stale.");
        world.store.update((s) => ({
          ...s,
          gauges: s.gauges.map((x) => (x.id === g.id ? { ...x, plotted: false } : x)),
        }));
        api.print(gaugePart(g), " removed from viewport plot.");
      },
    },
    {
      name: "Set Alarm",
      doc: "Set a gauge's alarm threshold (typed at the Listener).",
      args: [
        { name: "gauge", type: "gauge" },
        {
          name: "level",
          type: "number",
          input: "typed",
          prompt: "Alarm level [0..100]",
          default: () => ({ type: "number", ref: valueRef(85), label: "85" }),
          validate: (v) => {
            const n = "value" in v.ref ? Number(v.ref.value) : NaN;
            return n >= 0 && n <= 100 ? true : "alarm level must be between 0 and 100";
          },
        },
      ],
      run: (args, api) => {
        const g = api.resolve(args["gauge"]!) as Gauge | undefined;
        if (!g) return api.printErr("That gauge vanished — presentation was stale.");
        const n = (args["level"]!.ref as { value: number }).value;
        world.store.update((s) => ({
          ...s,
          gauges: s.gauges.map((x) => (x.id === g.id ? { ...x, alarm: n } : x)),
        }));
        api.print(gaugePart(g), ` alarm level set to ${n}.`);
      },
    },
    {
      name: "Reset Peak",
      doc: "Reset a gauge's recorded peak value.",
      args: [{ name: "gauge", type: "gauge" }],
      run: (args, api) => {
        const g = api.resolve(args["gauge"]!) as Gauge | undefined;
        if (!g) return api.printErr("That gauge vanished — presentation was stale.");
        world.store.update((s) => ({
          ...s,
          gauges: s.gauges.map((x) => (x.id === g.id ? { ...x, peak: x.value } : x)),
        }));
        api.print(gaugePart(g), " peak reset.");
      },
    },
    {
      name: "Assign Port",
      doc: "Wire a gauge into a readout port. Two typed arguments, both by pointing.",
      args: [
        { name: "port", type: "port" },
        { name: "gauge", type: "gauge" },
      ],
      isDefaultFor: ["port"],
      run: (args, api) => {
        const p = api.resolve(args["port"]!) as Port | undefined;
        const g = api.resolve(args["gauge"]!) as Gauge | undefined;
        if (!p || !g) return api.printErr("A port or gauge vanished — presentation was stale.");
        world.store.update((s) => ({
          ...s,
          ports: s.ports.map((x) => (x.index === p.index ? { ...x, gaugeId: g.id } : x)),
        }));
        api.print(portPart(p), " wired to ", gaugePart(g), ".");
      },
    },
    {
      name: "Clear Port",
      doc: "Disconnect a readout port.",
      args: [{ name: "port", type: "port" }],
      appliesTo: (pres) => resolvePort(pres.ref)?.gaugeId != null,
      run: (args, api) => {
        const p = api.resolve(args["port"]!) as Port | undefined;
        if (!p) return api.printErr("That port vanished — presentation was stale.");
        world.store.update((s) => ({
          ...s,
          ports: s.ports.map((x) => (x.index === p.index ? { ...x, gaugeId: null } : x)),
        }));
        api.print(portPart(p), ' disconnected.  "No Port".');
      },
    },
    {
      name: "Pause",
      global: true,
      doc: "Freeze the simulated telemetry stream.",
      run: (_a, api) => {
        world.store.update((s) => ({ ...s, paused: true }));
        api.print("Telemetry stream paused.");
      },
    },
    {
      name: "Resume",
      global: true,
      doc: "Resume the simulated telemetry stream.",
      run: (_a, api) => {
        world.store.update((s) => ({ ...s, paused: false }));
        api.print("Telemetry stream resumed.");
      },
    },
    {
      name: "Clear Listener",
      global: true,
      doc: "Clear the Listener transcript.",
      run: () => engine.transcript.clear(),
    },
    {
      name: "Show Herald",
      global: true,
      run: (_a, api) => {
        api.print(
          B("PRESENTA — Metrics II"),
          " — a PBUI port. 18 telemetry channels, a strip-chart viewport, 8 readout ports.",
        );
        api.print(
          "Left-click a gauge toggles plotting. ",
          B("Assign Port"),
          ": click a readout port, then click a gauge — the classic two-click CLIM demo.",
        );
        api.print(
          "Mouse-R on any gauge or port for its command menu; background Mouse-R for global commands.",
        );
      },
    },
    {
      name: "Hardcopy",
      global: true,
      doc: "Print a unicode sparkline of a gauge's history to the (imaginary) LGP-2.",
      args: [{ name: "gauge", type: "gauge" }],
      run: (args, api) => {
        const g = api.resolve(args["gauge"]!) as Gauge | undefined;
        if (!g) return api.printErr("That gauge vanished — presentation was stale.");
        api.print("Hardcopy of ", gaugePart(g), " queued to LGP-2 on SATURN:");
        api.print(`  ${sparkline(g.history)}`);
        api.print(
          `  ${g.history.length} samples, peak ${g.peak.toFixed(1)}, alarm ${g.alarm} — 1 request in queue; estimated 40 seconds.`,
        );
      },
    },
  ]);

  const resolver: Resolver = {
    resolve: (ref) => {
      if (!("id" in ref)) return undefined;
      if (ref.kind === "gauge") return world.gauge(ref.id);
      if (ref.kind === "port") return world.port(ref.id);
      return undefined;
    },
  };
  const engine = new PbuiEngine<World>({
    ptypes,
    commands,
    world,
    resolver,
    idleDoc:
      "PRESENTA Metrics II — hover any presentation; Mouse-R: menu; background Mouse-R: global commands.",
  });
  return engine;
}

/* ----------------------------------- view ----------------------------------- */

function useEngineWorld(): PbuiEngine<World> {
  return useEngine<World>();
}

function GaugeCell({ g }: { g: Gauge }) {
  const alarmed = g.value >= g.alarm;
  return (
    <Presentation
      type="gauge"
      object={{ kind: "gauge", id: g.id }}
      label={g.id}
      block
      style={{
        border: "1px solid var(--pbui-ink)",
        position: "relative",
        padding: "1px 2px",
        textAlign: "center",
        background: alarmed
          ? "repeating-linear-gradient(45deg, var(--pbui-paper) 0 3px, var(--pbui-ink) 3px 4px)"
          : undefined,
      }}
    >
      <div
        style={{
          fontSize: 8.5,
          fontWeight: 700,
          letterSpacing: 0.5,
          whiteSpace: "nowrap",
          overflow: "hidden",
          background: "var(--pbui-paper)",
        }}
      >
        {g.name}
      </div>
      <svg viewBox="0 0 64 64" style={{ width: 50, height: 50, display: "block", margin: "0 auto" }}>
        <circle cx={32} cy={32} r={26} fill="var(--pbui-paper)" stroke="var(--pbui-ink)" strokeWidth={2.5} />
        <path d={wedgePath(32, 32, 26, g.value / 100)} fill="var(--pbui-ink)" />
        {/* alarm tick */}
        <line
          x1={32}
          y1={32}
          x2={32 + 30 * Math.cos(-Math.PI / 2 + (g.alarm / 100) * 2 * Math.PI)}
          y2={32 + 30 * Math.sin(-Math.PI / 2 + (g.alarm / 100) * 2 * Math.PI)}
          stroke="var(--pbui-ink)"
          strokeWidth={1.5}
          strokeDasharray="2 2"
        />
        <line x1={32} y1={32} x2={58} y2={32} stroke="var(--pbui-ink)" strokeWidth={1.5} />
      </svg>
      {g.plotted && (
        <span style={{ position: "absolute", right: 2, top: 0, fontSize: 10, background: "var(--pbui-paper)" }}>▪</span>
      )}
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          display: "inline-block",
          padding: "0 3px",
          background: "var(--pbui-paper)",
        }}
      >
        {g.value.toFixed(1)}
      </div>
    </Presentation>
  );
}

function GaugesPane() {
  const engine = useEngineWorld();
  const state = useStore(engine.world.store);
  return (
    <Pane
      title="Gauges"
      subtitle="6 metrics × 3 nodes"
      style={{ flex: 2, minWidth: 0 }}
      bodyStyle={{
        display: "grid",
        gridTemplateColumns: `repeat(${NODES.length}, 1fr)`,
        alignContent: "start",
        overflowY: "auto",
      }}
    >
      {NODES.map((n) => (
        <div
          key={n}
          style={{
            textAlign: "center",
            fontWeight: 700,
            fontSize: 10,
            borderBottom: "1px solid var(--pbui-ink)",
            padding: "1px 0",
          }}
        >
          {n}
        </div>
      ))}
      {METRIC_ROWS.flatMap((_, r) =>
        NODES.map((_, c) => {
          const g = state.gauges[r * NODES.length + c]!;
          return <GaugeCell key={g.id} g={g} />;
        }),
      )}
    </Pane>
  );
}

function ViewportPane() {
  const engine = useEngineWorld();
  const state = useStore(engine.world.store);
  const W = 760;
  const H = 430;
  const plotted = state.gauges.filter((g) => g.plotted);
  const lanes = plotted.slice(0, 5);
  const laneH = lanes.length ? (H - 40) / lanes.length : 0;
  return (
    <Pane
      title="Viewport"
      subtitle={`${plotted.length} plotted`}
      style={{ flex: 3, minWidth: 0 }}
      bodyStyle={{ padding: 0, display: "flex" }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ flex: 1, width: "100%", height: "100%", display: "block" }}
      >
        {cubeEdges(state.angle, W).map(([[x1, y1], [x2, y2]], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--pbui-ink)" strokeWidth={1.4} />
        ))}
        {lanes.map((g, i) => {
          const top = 24 + i * laneH;
          const bot = top + laneH - 14;
          const pts = g.history
            .map((v, j) => `${(j / (HISTORY - 1)) * (W - 130) + 12},${bot - (v / 100) * (laneH - 26)}`)
            .join(" ");
          const ay = bot - (g.alarm / 100) * (laneH - 26);
          return (
            <g key={g.id}>
              <line x1={12} y1={bot} x2={W - 118} y2={bot} stroke="var(--pbui-ink)" strokeWidth={1.5} />
              <line
                x1={12}
                y1={ay}
                x2={W - 118}
                y2={ay}
                stroke="var(--pbui-ink)"
                strokeWidth={1}
                strokeDasharray="3 4"
              />
              <polyline points={pts} fill="none" stroke="var(--pbui-ink)" strokeWidth={1.8} />
              <SvgPresentation
                type="gauge"
                object={{ kind: "gauge", id: g.id }}
                label={g.id}
                hitRect={{ x: 12, y: top - 9, width: 260, height: 14 }}
              >
                <text
                  x={14}
                  y={top + 2}
                  fill="var(--pbui-ink)"
                  style={{ font: "700 11px ui-monospace, Menlo, monospace", letterSpacing: 1 }}
                >
                  {g.name} @ {g.node} — {g.value.toFixed(1)}
                  {g.value >= g.alarm ? "  !ALARM" : ""}
                </text>
              </SvgPresentation>
            </g>
          );
        })}
        {lanes.length === 0 && (
          <text
            x={W / 2}
            y={H / 2}
            textAnchor="middle"
            fill="var(--pbui-ink)"
            style={{ font: "12px ui-monospace, Menlo, monospace", letterSpacing: 1 }}
          >
            No GAUGE plotted — Mouse-R on a gauge and choose Plot Gauge
          </text>
        )}
        {plotted.length > lanes.length && (
          <text
            x={W - 12}
            y={H - 8}
            textAnchor="end"
            fill="var(--pbui-ink)"
            style={{ font: "11px ui-monospace, Menlo, monospace" }}
          >
            +{plotted.length - lanes.length} more plotted (5 lanes shown)
          </text>
        )}
        {state.paused && (
          <text
            x={W / 2}
            y={18}
            textAnchor="middle"
            fill="var(--pbui-ink)"
            style={{ font: "700 11px ui-monospace, Menlo, monospace", letterSpacing: 1 }}
          >
            — TELEMETRY PAUSED —
          </text>
        )}
      </svg>
    </Pane>
  );
}

function PortsPane() {
  const engine = useEngineWorld();
  const state = useStore(engine.world.store);
  return (
    <Pane
      title="Readout Ports"
      subtitle="Assign Port: click a port, then a gauge"
      bodyStyle={{ display: "grid", gridTemplateColumns: `repeat(${N_PORTS}, 1fr)`, gap: 4 }}
    >
      {state.ports.map((p) => {
        const g = p.gaugeId ? state.gauges.find((x) => x.id === p.gaugeId) : undefined;
        return (
          <Presentation
            key={p.id}
            type="port"
            object={{ kind: "port", id: p.id }}
            label={p.id}
            block
            style={{
              border: "1.5px solid var(--pbui-ink)",
              textAlign: "center",
              minHeight: 52,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 1,
                borderBottom: "1px solid var(--pbui-ink)",
              }}
            >
              {p.id}
            </div>
            {g ? (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>{g.name}</div>
                <div style={{ fontSize: 8 }}>{g.node}</div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{g.value.toFixed(0)}</div>
              </div>
            ) : (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", letterSpacing: 2 }}>
                —
              </div>
            )}
          </Presentation>
        );
      })}
    </Pane>
  );
}

function MetricsApp({ engine }: { engine: PbuiEngine<World> }) {
  const surface = usePbuiSurface();
  const state = useStore(engine.world.store);

  const heraldRan = useRef(false);
  useEffect(() => {
    if (heraldRan.current) return; // StrictMode double-mount guard
    heraldRan.current = true;
    engine.startCommand("Show Herald");
  }, [engine]);

  // the telemetry keeps ticking while you point; accepting highlights persist
  useEffect(() => {
    const t = setInterval(() => engine.world.store.update(tick), TICK_MS);
    return () => clearInterval(t);
  }, [engine]);

  return (
    <div
      className="pbui-root"
      style={{ height: "100vh", display: "flex", flexDirection: "column" }}
      {...surface}
    >
      <div className="demo-back">
        <a href="#">← demos</a>
      </div>
      <div style={{ display: "flex", gap: 8, padding: 8, flex: 3, minHeight: 0 }}>
        <GaugesPane />
        <ViewportPane />
      </div>
      <div style={{ padding: "0 8px" }}>
        <PortsPane />
      </div>
      <div style={{ display: "flex", padding: 8, flex: 1.2, minHeight: 140 }}>
        <Pane
          title="Listener"
          subtitle="Dynamic Lisp Listener 2"
          style={{ flex: 1 }}
          bodyStyle={{ padding: 0, display: "flex" }}
        >
          <Listener style={{ flex: 1 }} prompt="SATURN> " />
        </Pane>
      </div>
      <ContextMenuHost />
      <MouseDocBar right={state.paused ? "TELEMETRY PAUSED" : `t=${state.simTime.toFixed(0)}s`} />
      <StatusLine user="david" pkg="CL-USER" host="SATURN" />
    </div>
  );
}

export default function MetricsDemo() {
  const engine = useMemo(() => makeEngine(makeWorld()), []);
  return (
    <PbuiProvider engine={engine}>
      <MetricsApp engine={engine} />
    </PbuiProvider>
  );
}

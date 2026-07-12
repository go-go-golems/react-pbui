import React, { useState, useEffect, useRef, useCallback } from "react";

/* ============================================================
   DESIGN KIT — feedback control graphs, CLIM / Dynamic-Windows
   ------------------------------------------------------------
   Every unit, port, and stream on the canvas is a *presentation*
   of an underlying object. Commands read typed arguments in the
   interactor; while a command reads a PORT, only eligible ports
   are mouse-sensitive (the input context). Right-click = menu of
   commands applicable to the presentation under the pointer,
   pre-supplying it as an argument (presentation translators).
   The graph is simulated live: build a loop and it regulates.
   ============================================================ */

// ---------- unit type catalog ------------------------------------------
// port coords are fractions of the shape box; dir 'in' | 'out'
const TYPES = {
  TANK: {
    label: "Tank/Reactor", prefix: "T", w: 92, h: 104,
    ports: [
      { key: "IN", dir: "in", x: 0.5, y: 0 },
      { key: "OUT", dir: "in", x: 0.5, y: 1 },
      { key: "LEVEL", dir: "out", x: 1, y: 0.5 },
    ],
    params: { AREA: 3, LEVEL0: 30, DEMAND: 8 },
    doc: "Integrating process. LEVEL rises with IN flow, falls with OUT demand (or DEMAND param if OUT is unconnected).",
  },
  VALVE: {
    label: "Control-Valve", prefix: "V", w: 72, h: 50,
    ports: [
      { key: "CMD", dir: "in", x: 0.5, y: 0 },
      { key: "FLOW", dir: "out", x: 1, y: 0.5 },
    ],
    params: { GAIN: 30, TAU: 0.8 },
    doc: "Actuator. FLOW approaches GAIN × CMD/100 with time constant TAU.",
  },
  SOURCE: {
    label: "Feed-Source", prefix: "F", w: 104, h: 34,
    ports: [{ key: "OUT", dir: "out", x: 1, y: 0.5 }],
    params: { VALUE: 8, "STEP-TO": 8, "STEP-AT": 9999 },
    doc: "Signal source. Emits VALUE, stepping to STEP-TO at t = STEP-AT seconds.",
  },
  SETPOINT: {
    label: "Setpoint", prefix: "SP", w: 104, h: 34,
    ports: [{ key: "OUT", dir: "out", x: 1, y: 0.5 }],
    params: { VALUE: 50 },
    doc: "Reference signal for a control loop.",
  },
  PID: {
    label: "PID-Controller", prefix: "LC", w: 62, h: 62,
    ports: [
      { key: "IN", dir: "in", x: 0, y: 0.5 },
      { key: "OUT", dir: "out", x: 1, y: 0.5 },
    ],
    params: { KP: 4, KI: 0.5, KD: 0, MIN: 0, MAX: 100 },
    doc: "PID controller. Reads the error, writes an output clamped to [MIN, MAX] with integral anti-windup.",
  },
  SENSOR: {
    label: "Transmitter", prefix: "LT", w: 50, h: 50,
    ports: [
      { key: "IN", dir: "in", x: 1, y: 0.5 },
      { key: "OUT", dir: "out", x: 0, y: 0.5 },
    ],
    params: { TAU: 0.5, NOISE: 0.5 },
    doc: "Measurement device. First-order lag TAU plus NOISE. Drawn reversed: signal flows right-to-left on feedback legs.",
  },
  SUM: {
    label: "Sum-Junction", prefix: "J", w: 38, h: 38,
    ports: [
      { key: "PLUS", dir: "in", x: 0, y: 0.5 },
      { key: "MINUS", dir: "in", x: 0.5, y: 1 },
      { key: "OUT", dir: "out", x: 1, y: 0.5 },
    ],
    params: {},
    doc: "Comparator. OUT = PLUS − MINUS (the loop error).",
  },
  GAIN: {
    label: "Gain", prefix: "K", w: 58, h: 46,
    ports: [
      { key: "IN", dir: "in", x: 0, y: 0.5 },
      { key: "OUT", dir: "out", x: 1, y: 0.5 },
    ],
    params: { K: 1 },
    doc: "Multiplies its input by K.",
  },
  LAG: {
    label: "First-Order-Lag", prefix: "G", w: 84, h: 42,
    ports: [
      { key: "IN", dir: "in", x: 0, y: 0.5 },
      { key: "OUT", dir: "out", x: 1, y: 0.5 },
    ],
    params: { TAU: 2 },
    doc: "First-order lag 1/(τs+1).",
  },
  SCOPE: {
    label: "Trend-Scope", prefix: "SC", w: 150, h: 88,
    ports: [
      { key: "IN", dir: "in", x: 0, y: 0.5 },
      { key: "OUT", dir: "out", x: 1, y: 0.5 },
    ],
    params: {},
    doc: "Records and displays its input signal. OUT passes the signal through.",
  },
};
const TYPE_KEYS = Object.keys(TYPES);

const DT = 0.06, SUBSTEPS = 3, TICK_MS = 120, HIST = 240;
const fmt = (v) => (v == null || isNaN(v)) ? "—"
  : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
const addr = () => String(20000000 + Math.floor(Math.random() * 79999999));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let __id = 100;
const counters = {};
const nextName = (type) => {
  const p = TYPES[type].prefix;
  counters[p] = (counters[p] || 0) + 1;
  return `${p}-${counters[p]}`;
};

const pUnit = (n) => `#<${n.type} ${n.name} ${n.addr}>`;
const pPort = (n, key) => `#<STREAM-PORT ${n.portAddrs[key]} ${n.name}.${key}>`;
const pStream = (s) => `#<STREAM ${s.name} ${s.addr}>`;

function initState(type, params) {
  switch (type) {
    case "TANK": return { level: params.LEVEL0, outs: { LEVEL: params.LEVEL0 } };
    case "PID": return { i: 0, prev: 0, outs: { OUT: 0 } };
    case "VALVE": return { y: 0, outs: { FLOW: 0 } };
    case "SENSOR": return { y: 0, outs: { OUT: 0 } };
    case "LAG": return { y: 0, outs: { OUT: 0 } };
    case "SCOPE": return { hist: [], outs: { OUT: 0 } };
    case "SETPOINT": return { outs: { OUT: params.VALUE } };
    case "SOURCE": return { outs: { OUT: params.VALUE } };
    default: return { outs: { OUT: 0 } };
  }
}

function makeUnit(type, pos, name) {
  const t = TYPES[type];
  const portAddrs = {};
  t.ports.forEach((p) => (portAddrs[p.key] = addr()));
  const params = { ...t.params };
  return { id: ++__id, addr: addr(), type, name: name || nextName(type),
    pos, params, portAddrs, state: initState(type, params) };
}

// ---------- one simulation substep --------------------------------------
function stepOnce(nodes, conns, t) {
  const prev = {};
  nodes.forEach((n) => Object.entries(n.state.outs).forEach(([k, v]) => (prev[`${n.id}:${k}`] = v)));
  const getIn = (n, key) => {
    const c = conns.find((c) => c.to.nodeId === n.id && c.to.key === key);
    return c ? prev[`${c.from.nodeId}:${c.from.key}`] : undefined;
  };
  return nodes.map((n) => {
    const P = n.params, S = n.state;
    switch (n.type) {
      case "SETPOINT":
        return { ...n, state: { outs: { OUT: P.VALUE } } };
      case "SOURCE": {
        const v = t < P["STEP-AT"] ? P.VALUE : P["STEP-TO"];
        return { ...n, state: { outs: { OUT: v } } };
      }
      case "SUM": {
        const v = (getIn(n, "PLUS") ?? 0) - (getIn(n, "MINUS") ?? 0);
        return { ...n, state: { outs: { OUT: v } } };
      }
      case "GAIN":
        return { ...n, state: { outs: { OUT: P.K * (getIn(n, "IN") ?? 0) } } };
      case "LAG": {
        const y = S.y + (DT / Math.max(P.TAU, 0.01)) * ((getIn(n, "IN") ?? 0) - S.y);
        return { ...n, state: { y, outs: { OUT: y } } };
      }
      case "PID": {
        const e = getIn(n, "IN") ?? 0;
        let i = S.i + P.KI * e * DT;
        i = clamp(i, P.MIN - 50, P.MAX + 50);
        const d = P.KD * (e - S.prev) / DT;
        let u = P.KP * e + i + d;
        if (u > P.MAX) { u = P.MAX; i = S.i; }
        if (u < P.MIN) { u = P.MIN; i = S.i; }
        return { ...n, state: { i, prev: e, outs: { OUT: u } } };
      }
      case "VALVE": {
        const cmd = clamp(getIn(n, "CMD") ?? 0, 0, 100);
        const y = S.y + (DT / Math.max(P.TAU, 0.01)) * ((P.GAIN * cmd) / 100 - S.y);
        return { ...n, state: { y, outs: { FLOW: y } } };
      }
      case "TANK": {
        const inflow = getIn(n, "IN") ?? 0;
        const demand = getIn(n, "OUT") ?? P.DEMAND;
        const level = clamp(S.level + (DT / Math.max(P.AREA, 0.01)) * (inflow - demand), 0, 100);
        return { ...n, state: { level, outs: { LEVEL: level } } };
      }
      case "SENSOR": {
        const y = S.y + (DT / Math.max(P.TAU, 0.01)) * ((getIn(n, "IN") ?? 0) - S.y);
        const out = y + P.NOISE * (Math.random() - 0.5);
        return { ...n, state: { y, outs: { OUT: out } } };
      }
      case "SCOPE": {
        const v = getIn(n, "IN") ?? 0;
        const hist = [...(S.hist || []).slice(-(HIST - 1)), v];
        return { ...n, state: { hist, outs: { OUT: v } } };
      }
      default:
        return n;
    }
  });
}

// ---------- seed model: tank level control loop --------------------------
function seed() {
  const sp = makeUnit("SETPOINT", { x: 24, y: 66 });
  const j = makeUnit("SUM", { x: 196, y: 64 });
  const lc = makeUnit("PID", { x: 292, y: 52 });
  const v = makeUnit("VALVE", { x: 420, y: 58 });
  const t = makeUnit("TANK", { x: 580, y: 96 });
  const lt = makeUnit("SENSOR", { x: 420, y: 252 });
  const f = makeUnit("SOURCE", { x: 700, y: 300 });
  const sc = makeUnit("SCOPE", { x: 760, y: 66 });
  f.name = "DEMAND-1"; f.params["STEP-TO"] = 13; f.params["STEP-AT"] = 45;
  let s = 0;
  const C = (a, ak, b, bk) => ({ id: ++__id, addr: addr(), name: `S-${++s}`,
    from: { nodeId: a.id, key: ak }, to: { nodeId: b.id, key: bk } });
  const conns = [
    C(sp, "OUT", j, "PLUS"),
    C(lt, "OUT", j, "MINUS"),
    C(j, "OUT", lc, "IN"),
    C(lc, "OUT", v, "CMD"),
    C(v, "FLOW", t, "IN"),
    C(t, "LEVEL", lt, "IN"),
    C(t, "LEVEL", sc, "IN"),
    C(f, "OUT", t, "OUT"),
  ];
  return { nodes: [sp, j, lc, v, t, lt, f, sc], conns, nextStream: s };
}

// ---------- command table ------------------------------------------------
const COMMANDS = [
  { name: "Add Unit", pointer: true, args: [
      { name: "unit type", type: "choice", options: TYPE_KEYS },
      { name: "position", type: "position" } ] },
  { name: "Manual Connect", pointer: true, args: [
      { name: "from port", type: "port", dir: "out" },
      { name: "to port", type: "port", dir: "in" } ] },
  { name: "Disconnect", pointer: true, args: [{ name: "stream", type: "stream" }] },
  { name: "Inspect", pointer: true, args: [{ name: "unit", type: "unit" }] },
  { name: "Describe", pointer: true, args: [{ name: "unit", type: "unit" }] },
  { name: "Describe Stream", pointer: true, args: [{ name: "stream", type: "stream" }] },
  { name: "Set Parameter", pointer: true, args: [
      { name: "unit", type: "unit" },
      { name: "parameter", type: "choice", options: (a) => Object.keys(a.unit?.params || {}) },
      { name: "value", type: "number" } ] },
  { name: "Rename Unit", pointer: true, args: [
      { name: "unit", type: "unit" }, { name: "new name", type: "string" } ] },
  { name: "Move", pointer: true, args: [
      { name: "unit", type: "unit" }, { name: "position", type: "position" } ] },
  { name: "Delete", pointer: true, args: [{ name: "unit", type: "unit" }] },
  { name: "Run", args: [] },
  { name: "Pause", args: [] },
  { name: "Step", args: [] },
  { name: "Reset Simulation", args: [] },
  { name: "Check Consistency", args: [] },
  { name: "Redisplay", args: [] },
  { name: "Erase Screen", args: [] },
  { name: "Save", args: [] },
  { name: "Help", args: [] },
  { name: "Exit", args: [] },
];
const findCommand = (n) => COMMANDS.find((c) => c.name === n);

const MENU_GROUPS = [
  { title: "PROCESS UNITS", items: ["TANK", "VALVE", "SOURCE"].map((k) => ({
      label: TYPES[k].label, pointer: true, action: { cmd: "Add Unit", preset: { "unit type": k } } })) },
  { title: "CONTROL.& INSTRUM.", items: ["SETPOINT", "PID", "SENSOR", "SUM", "GAIN", "LAG", "SCOPE"].map((k) => ({
      label: TYPES[k].label, pointer: true, action: { cmd: "Add Unit", preset: { "unit type": k } } })) },
  { title: "DISPLAY OPERATIONS", items: [
      { label: "Manual-Connect", pointer: true, action: { cmd: "Manual Connect" } },
      { label: "Disconnect", pointer: true, action: { cmd: "Disconnect" } },
      { label: "Set-Parameter", pointer: true, action: { cmd: "Set Parameter" } },
      { label: "Inspect", pointer: true, action: { cmd: "Inspect" } },
      { label: "Rename-Unit", pointer: true, action: { cmd: "Rename Unit" } },
      { label: "Move", pointer: true, action: { cmd: "Move" } },
      { label: "Delete", pointer: true, action: { cmd: "Delete" } },
      { label: "Erase-Screen", action: { cmd: "Erase Screen" } },
      { label: "Redisplay", action: { cmd: "Redisplay" } } ] },
  { title: "SIMULATION", items: [
      { label: "Run", action: { cmd: "Run" } },
      { label: "Pause", action: { cmd: "Pause" } },
      { label: "Step", action: { cmd: "Step" } },
      { label: "Reset", action: { cmd: "Reset Simulation" } } ] },
  { title: "PROGRAM OPERATIONS", items: [
      { label: "Save", action: { cmd: "Save" } },
      { label: "Check-Consistency", action: { cmd: "Check Consistency" } },
      { label: "Help", action: { cmd: "Help" } },
      { label: "Exit", action: { cmd: "Exit" } } ] },
];

const UNIT_CONTEXT = ["Inspect", "Describe", "Set Parameter", "Rename Unit", "Move", "Delete"];
const STREAM_CONTEXT = ["Describe Stream", "Disconnect"];
const CANVAS_CONTEXT = ["Add Unit", "Manual Connect", "Check Consistency", "Redisplay", "Erase Screen"];

// ---------- geometry ------------------------------------------------------
const portXY = (n, key) => {
  const t = TYPES[n.type];
  const p = t.ports.find((x) => x.key === key);
  return { x: n.pos.x + p.x * t.w, y: n.pos.y + p.y * t.h, def: p };
};
const stub = (p) => {
  // outward stub direction from the shape edge
  const d = p.def;
  if (d.x === 0) return { x: p.x - 12, y: p.y };
  if (d.x === 1) return { x: p.x + 12, y: p.y };
  if (d.y === 0) return { x: p.x, y: p.y - 12 };
  return { x: p.x, y: p.y + 12 };
};
function routeConn(nodes, c) {
  const nf = nodes.find((n) => n.id === c.from.nodeId);
  const nt = nodes.find((n) => n.id === c.to.nodeId);
  if (!nf || !nt) return null;
  const a = portXY(nf, c.from.key), b = portXY(nt, c.to.key);
  const sa = stub(a), sb = stub(b);
  const mx = (sa.x + sb.x) / 2;
  const pts = [a, sa, { x: mx, y: sa.y }, { x: mx, y: sb.y }, sb, b];
  const mid = { x: mx, y: (sa.y + sb.y) / 2 };
  return { pts, mid, a, b };
}

// ---------- shape rendering ----------------------------------------------
function Shape({ n }) {
  const t = TYPES[n.type], w = t.w, h = t.h;
  const S = n.state, P = n.params;
  switch (n.type) {
    case "TANK": {
      const lvl = clamp(S.level ?? 0, 0, 100) / 100;
      const ih = h - 4, fillH = ih * lvl;
      return (
        <svg width={w} height={h} className="dk-shape">
          <defs>
            <pattern id={`ht${n.id}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#000" strokeWidth="1.5" />
            </pattern>
          </defs>
          <rect x="2" y={2 + ih - fillH} width={w - 4} height={fillH} fill={`url(#ht${n.id})`} />
          <rect x="2" y="2" width={w - 4} height={h - 4} fill="none" stroke="#000" strokeWidth="2" />
          <rect x="2" y="2" width={w - 4} height="12" fill="#fff" stroke="#000" strokeWidth="2" />
          <text x={w / 2} y="11.5" textAnchor="middle" fontSize="9" fontWeight="bold">{fmt(S.level)}%</text>
        </svg>
      );
    }
    case "VALVE":
      return (
        <svg width={w} height={h} className="dk-shape">
          <line x1={w / 2} y1="2" x2={w / 2} y2={h / 2} stroke="#000" strokeWidth="2" />
          <line x1={w / 2 - 10} y1="2" x2={w / 2 + 10} y2="2" stroke="#000" strokeWidth="2" />
          <polygon points={`4,${h / 2 - 16} 4,${h / 2 + 16} ${w / 2},${h / 2}`} fill="#fff" stroke="#000" strokeWidth="2" />
          <polygon points={`${w - 4},${h / 2 - 16} ${w - 4},${h / 2 + 16} ${w / 2},${h / 2}`} fill="#fff" stroke="#000" strokeWidth="2" />
        </svg>
      );
    case "PID":
    case "SENSOR": {
      const r = Math.min(w, h) / 2 - 3;
      return (
        <svg width={w} height={h} className="dk-shape">
          <circle cx={w / 2} cy={h / 2} r={r} fill="#fff" stroke="#000" strokeWidth="2" />
          {n.type === "SENSOR" && <line x1={w / 2 - r} y1={h / 2 + 6} x2={w / 2 + r} y2={h / 2 + 6} stroke="#000" strokeWidth="1.5" />}
          <text x={w / 2} y={h / 2 + (n.type === "SENSOR" ? 0 : 4)} textAnchor="middle" fontSize="11" fontWeight="bold">
            {n.name.split("-")[0]}
          </text>
          {n.type === "SENSOR" && <text x={w / 2} y={h / 2 + 15} textAnchor="middle" fontSize="8">{n.name.split("-")[1]}</text>}
        </svg>
      );
    }
    case "SUM":
      return (
        <svg width={w} height={h} className="dk-shape">
          <circle cx={w / 2} cy={h / 2} r={w / 2 - 3} fill="#fff" stroke="#000" strokeWidth="2" />
          <line x1={w * 0.22} y1={h * 0.22} x2={w * 0.78} y2={h * 0.78} stroke="#000" strokeWidth="1.5" />
          <line x1={w * 0.78} y1={h * 0.22} x2={w * 0.22} y2={h * 0.78} stroke="#000" strokeWidth="1.5" />
          <text x="4" y={h / 2 - 4} fontSize="11" fontWeight="bold">+</text>
          <text x={w / 2 + 6} y={h - 4} fontSize="11" fontWeight="bold">−</text>
        </svg>
      );
    case "GAIN":
      return (
        <svg width={w} height={h} className="dk-shape">
          <polygon points={`3,3 3,${h - 3} ${w - 3},${h / 2}`} fill="#fff" stroke="#000" strokeWidth="2" />
          <text x={w * 0.35} y={h / 2 + 4} textAnchor="middle" fontSize="10" fontWeight="bold">K={fmt(P.K)}</text>
        </svg>
      );
    case "LAG":
      return (
        <svg width={w} height={h} className="dk-shape">
          <rect x="2" y="2" width={w - 4} height={h - 4} fill="#fff" stroke="#000" strokeWidth="2" />
          <text x={w / 2} y={h / 2 - 2} textAnchor="middle" fontSize="10" fontWeight="bold">1</text>
          <line x1={w * 0.2} y1={h / 2 + 1} x2={w * 0.8} y2={h / 2 + 1} stroke="#000" strokeWidth="1.5" />
          <text x={w / 2} y={h - 8} textAnchor="middle" fontSize="10">τs+1</text>
        </svg>
      );
    case "SETPOINT":
    case "SOURCE":
      return (
        <svg width={w} height={h} className="dk-shape">
          <rect x="2" y="2" width={w - 4} height={h - 4} rx={(h - 4) / 2} fill="#fff" stroke="#000" strokeWidth="2" />
          <text x={w / 2} y={h / 2 + 4} textAnchor="middle" fontSize="11" fontWeight="bold">{n.name}</text>
        </svg>
      );
    case "SCOPE": {
      const d = S.hist || [];
      let pts = "";
      if (d.length > 1) {
        let lo = Math.min(...d), hi = Math.max(...d);
        if (hi - lo < 1e-9) hi = lo + 1;
        pts = d.map((v, i) =>
          `${4 + (i / (d.length - 1)) * (w - 8)},${h - 6 - ((v - lo) / (hi - lo)) * (h - 24)}`).join(" ");
      }
      return (
        <svg width={w} height={h} className="dk-shape">
          <rect x="2" y="2" width={w - 4} height={h - 4} fill="#fff" stroke="#000" strokeWidth="2" />
          <rect x="2" y="2" width={w - 4} height="13" fill="#000" />
          <text x={w / 2} y="12" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#fff">
            {fmt(d[d.length - 1])}
          </text>
          {pts && <polyline points={pts} fill="none" stroke="#000" strokeWidth="1.5" />}
        </svg>
      );
    }
    default:
      return null;
  }
}

// ========================================================================
export default function DesignKit() {
  const [{ nodes, conns }, setGraph] = useState(() => seed());
  const [lines, setLines] = useState([
    { t: "out", s: ";;; DESIGN KIT — feedback control graph editor & simulator." },
    { t: "out", s: ";;; A tank level loop is preloaded and running. DEMAND-1 steps at t=45s." },
    { t: "out", s: ";;; Right-click anything. Left-click a port to start Manual Connect." },
  ]);
  const [pending, setPending] = useState(null);
  const [typed, setTyped] = useState("");
  const [ctxMenu, setCtxMenu] = useState(null); // {x,y,kind,id}
  const [hover, setHover] = useState(null);
  const [running, setRunning] = useState(true);
  const [flash, setFlash] = useState(false);
  const [clock, setClock] = useState("");
  const [simTime, setSimTime] = useState(0);

  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const graphRef = useRef(null);
  graphRef.current = { nodes, conns };
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const typedRef = useRef(typed); typedRef.current = typed;
  const simTimeRef = useRef(0);
  const streamNoRef = useRef(9);
  const interactorRef = useRef(null);

  const print = useCallback((s, t = "out") => {
    setLines((L) => [...L.slice(-250), ...(Array.isArray(s) ? s.map((x) => ({ t, s: x })) : [{ t, s }])]);
  }, []);

  // ---- clock -----------------------------------------------------------
  useEffect(() => {
    const tick = () => {
      const n = new Date();
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const mos = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      setClock(`${days[n.getDay()]} ${n.getDate()} ${mos[n.getMonth()]} ${n.toTimeString().slice(0, 8)}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ---- simulation loop ---------------------------------------------------
  const stepSim = useCallback((k = SUBSTEPS) => {
    setGraph((g) => {
      let ns = g.nodes;
      for (let i = 0; i < k; i++) {
        ns = stepOnce(ns, g.conns, simTimeRef.current);
        simTimeRef.current += DT;
      }
      return { ...g, nodes: ns };
    });
    setSimTime(simTimeRef.current);
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => stepSim(), TICK_MS);
    return () => clearInterval(id);
  }, [running, stepSim]);

  useEffect(() => {
    if (interactorRef.current)
      interactorRef.current.scrollTop = interactorRef.current.scrollHeight;
  }, [lines, pending, typed]);

  // ---- argument machinery --------------------------------------------------
  const currentArg = (p) => (p ? findCommand(p.cmd).args[p.idx] : null);
  const argOptions = (arg, argsSoFar) =>
    typeof arg.options === "function" ? arg.options(argsSoFar) : arg.options;

  const eligiblePorts = useCallback((arg, argsSoFar) => {
    const g = graphRef.current;
    const out = [];
    g.nodes.forEach((n) => {
      TYPES[n.type].ports.forEach((p) => {
        if (p.dir !== arg.dir) return;
        if (arg.dir === "in" && argsSoFar["from port"] && argsSoFar["from port"].nodeId === n.id) return;
        out.push({ node: n, port: p });
      });
    });
    return out;
  }, []);

  const argDefault = useCallback((arg, p) => {
    const g = graphRef.current;
    switch (arg.type) {
      case "unit": return g.nodes[0] || null;
      case "stream": return g.conns[0] || null;
      case "port": {
        const e = eligiblePorts(arg, p?.args || {});
        return e.length ? { nodeId: e[0].node.id, key: e[0].port.key } : null;
      }
      case "choice": {
        const o = argOptions(arg, p?.args || {});
        return o && o.length ? o[0] : null;
      }
      case "number": {
        if (p?.cmd === "Set Parameter" && p.args.unit && p.args.parameter != null) {
          const n = g.nodes.find((x) => x.id === p.args.unit.id);
          if (n) return n.params[p.args.parameter];
        }
        return 0;
      }
      case "position": {
        const k = g.nodes.length;
        return { x: 60 + (k % 5) * 170, y: 60 + Math.floor(k / 5) * 140 };
      }
      case "string": return null;
      default: return null;
    }
  }, [eligiblePorts]);

  const describeVal = useCallback((arg, v) => {
    const g = graphRef.current;
    if (v == null) return "";
    if (arg.type === "unit") return pUnit(v);
    if (arg.type === "stream") return pStream(v);
    if (arg.type === "port") {
      const n = g.nodes.find((x) => x.id === v.nodeId);
      return n ? pPort(n, v.key) : "#<STREAM-PORT ?>";
    }
    if (arg.type === "position") return `(${Math.round(v.x)}, ${Math.round(v.y)})`;
    return String(v);
  }, []);

  const promptText = useCallback((p) => {
    const arg = currentArg(p);
    if (!arg) return "command: ";
    const def = argDefault(arg, p);
    const defTxt = def != null ? ` [default ${describeVal(arg, def)}]` : "";
    return `Enter ${/^[aeiou]/i.test(arg.name) ? "an" : "a"} ${arg.name}${defTxt}: `;
  }, [argDefault, describeVal]);

  // ---- command execution -------------------------------------------------
  const execute = useCallback((cmdName, args) => {
    const P = print;
    const g = graphRef.current;
    switch (cmdName) {
      case "Add Unit": {
        const u = makeUnit(args["unit type"], args.position);
        setGraph((gr) => ({ ...gr, nodes: [...gr.nodes, u] }));
        P(`=> created ${pUnit(u)}`);
        break;
      }
      case "Manual Connect": {
        const from = args["from port"], to = args["to port"];
        if (from.nodeId === to.nodeId) { P(";;; refusing to connect a unit to itself."); break; }
        const name = `S-${++streamNoRef.current}`;
        const c = { id: ++__id, addr: addr(), name, from, to };
        setGraph((gr) => {
          const removed = gr.conns.find((x) => x.to.nodeId === to.nodeId && x.to.key === to.key);
          if (removed) P(`;;; ${removed.name} superseded on that port and removed.`);
          return { ...gr, conns: [...gr.conns.filter((x) => x !== removed), c] };
        });
        const nf = g.nodes.find((x) => x.id === from.nodeId);
        const nt = g.nodes.find((x) => x.id === to.nodeId);
        P(`=> ${name} connected: ${nf?.name}.${from.key} ——> ${nt?.name}.${to.key}`);
        break;
      }
      case "Disconnect":
        setGraph((gr) => ({ ...gr, conns: gr.conns.filter((c) => c.id !== args.stream.id) }));
        P(`=> ${args.stream.name} disconnected.`);
        break;
      case "Inspect": {
        const n = g.nodes.find((x) => x.id === args.unit.id);
        if (!n) break;
        const t = TYPES[n.type];
        const ins = g.conns.filter((c) => c.to.nodeId === n.id)
          .map((c) => `${c.name} ← ${g.nodes.find((x) => x.id === c.from.nodeId)?.name}.${c.from.key} → ${n.name}.${c.to.key}`);
        const outs = g.conns.filter((c) => c.from.nodeId === n.id)
          .map((c) => `${c.name} → ${n.name}.${c.from.key} → ${g.nodes.find((x) => x.id === c.to.nodeId)?.name}.${c.to.key}`);
        P([
          `${pUnit(n)} is an instance of class ${n.type}:`,
          `   OUTPUT:      ${Object.entries(n.state.outs).map(([k, v]) => `${k}=${fmt(v)}`).join("  ")}`,
          `   PARAMETERS:  ${Object.entries(n.params).map(([k, v]) => `${k}=${fmt(v)}`).join("  ") || "none"}`,
          `   PORTS:       ${t.ports.map((p) => `${p.key}(${p.dir})`).join("  ")}`,
          ...(ins.length ? [`   IN-STREAMS:  ${ins.join("; ")}`] : []),
          ...(outs.length ? [`   OUT-STREAMS: ${outs.join("; ")}`] : []),
        ]);
        break;
      }
      case "Describe": {
        const n = g.nodes.find((x) => x.id === args.unit.id);
        if (!n) break;
        P(`${pUnit(n)}: ${TYPES[n.type].doc}`);
        break;
      }
      case "Describe Stream": {
        const c = g.conns.find((x) => x.id === args.stream.id);
        if (!c) break;
        const nf = g.nodes.find((x) => x.id === c.from.nodeId);
        const nt = g.nodes.find((x) => x.id === c.to.nodeId);
        const v = nf?.state.outs[c.from.key];
        P(`${pStream(c)}: carries ${fmt(v)} from ${nf?.name}.${c.from.key} to ${nt?.name}.${c.to.key}.`);
        break;
      }
      case "Set Parameter": {
        setGraph((gr) => ({ ...gr, nodes: gr.nodes.map((n) =>
          n.id === args.unit.id ? { ...n, params: { ...n.params, [args.parameter]: args.value } } : n) }));
        P(`=> ${args.unit.name} ${args.parameter} := ${fmt(args.value)}`);
        break;
      }
      case "Rename Unit":
        setGraph((gr) => ({ ...gr, nodes: gr.nodes.map((n) =>
          n.id === args.unit.id ? { ...n, name: args["new name"].toUpperCase().replace(/\s+/g, "-") } : n) }));
        P("=> renamed.");
        break;
      case "Move":
        setGraph((gr) => ({ ...gr, nodes: gr.nodes.map((n) =>
          n.id === args.unit.id ? { ...n, pos: args.position } : n) }));
        P(`=> moved ${args.unit.name}.`);
        break;
      case "Delete": {
        setGraph((gr) => ({
          nodes: gr.nodes.filter((n) => n.id !== args.unit.id),
          conns: gr.conns.filter((c) => c.from.nodeId !== args.unit.id && c.to.nodeId !== args.unit.id),
        }));
        P(`=> deleted ${pUnit(args.unit)} and its streams.`);
        break;
      }
      case "Run": setRunning(true); P("=> simulation running."); break;
      case "Pause": setRunning(false); P("=> simulation halted."); break;
      case "Step": stepSim(); P(`=> stepped to t=${(simTimeRef.current).toFixed(2)}s.`); break;
      case "Reset Simulation":
        simTimeRef.current = 0; setSimTime(0);
        setGraph((gr) => ({ ...gr, nodes: gr.nodes.map((n) => ({ ...n, state: initState(n.type, n.params) })) }));
        P("=> simulation state reset to t=0.");
        break;
      case "Check Consistency": {
        const msgs = [];
        g.nodes.forEach((n) => {
          TYPES[n.type].ports.filter((p) => p.dir === "in").forEach((p) => {
            const c = g.conns.find((c) => c.to.nodeId === n.id && c.to.key === p.key);
            if (!c) {
              if (n.type === "TANK" && p.key === "OUT")
                msgs.push(`;;; note: ${n.name}.OUT unconnected — using DEMAND parameter (${fmt(n.params.DEMAND)}).`);
              else msgs.push(`;;; WARNING: ${n.name}.${p.key} is unconnected (reads 0).`);
            }
          });
        });
        const loops = g.nodes.filter((n) => n.type === "PID").length;
        P([
          `;;; Checking ${g.nodes.length} units, ${g.conns.length} streams, ${loops} controller(s)...`,
          ...msgs,
          msgs.filter((m) => m.includes("WARNING")).length
            ? `;;; consistency check finished: ${msgs.filter((m) => m.includes("WARNING")).length} warning(s).`
            : ";;; consistency check finished: no violations.",
        ]);
        break;
      }
      case "Redisplay":
        setFlash(true); setTimeout(() => setFlash(false), 120);
        P("=> redisplayed.");
        break;
      case "Erase Screen":
        setGraph({ nodes: [], conns: [] });
        P("=> screen erased. All presentations discarded.");
        break;
      case "Save": {
        const out = ["(design", ...g.nodes.map((n) =>
          `  (unit ${n.name} :class ${n.type} :at (${Math.round(n.pos.x)} ${Math.round(n.pos.y)})${Object.entries(n.params).map(([k, v]) => ` :${k.toLowerCase()} ${fmt(v)}`).join("")})`),
          ...g.conns.map((c) => {
            const nf = g.nodes.find((x) => x.id === c.from.nodeId);
            const nt = g.nodes.find((x) => x.id === c.to.nodeId);
            return `  (stream ${c.name} (${nf?.name} ${c.from.key}) -> (${nt?.name} ${c.to.key}))`;
          }), "  )"];
        P(out);
        break;
      }
      case "Help":
        P([
          ";;; Build a control graph: add units from the right-hand menus, then",
          ";;; Manual Connect output ports to input ports. Left-clicking a port",
          ";;; starts a connection from (or to) it. Right-click any unit, stream",
          ";;; label, or empty canvas for its menu. Drag units to move them.",
          ";;; While a command reads an argument, only presentations of that type",
          ";;; are mouse-sensitive. RETURN accepts the [default]; ESCAPE aborts.",
          ";;; Try: Set Parameter LC-1 KP 40 — then watch the loop go unstable.",
        ]);
        break;
      case "Exit":
        P(";;; This world has no exit. Command aborted.");
        break;
      default:
        P(`Unimplemented command ${cmdName}.`);
    }
  }, [print, stepSim]);

  const advance = useCallback((p) => {
    const cmd = findCommand(p.cmd);
    let i = p.idx;
    while (i < cmd.args.length && p.args[cmd.args[i].name] !== undefined) i++;
    if (i >= cmd.args.length) {
      setPending(null); setTyped("");
      execute(p.cmd, p.args);
      return;
    }
    setPending({ ...p, idx: i });
    setTyped("");
  }, [execute]);

  const startCommand = useCallback((cmdName, preset = {}) => {
    const cmd = findCommand(cmdName);
    if (!cmd) return;
    setCtxMenu(null);
    const presetEcho = Object.entries(preset).map(([k, v]) => {
      const arg = cmd.args.find((a) => a.name === k);
      return arg ? ` (${k}: ${describeVal(arg, v)})` : "";
    }).join("");
    print(`command: ${cmdName}${presetEcho}`, "cmd");
    if (cmd.args.length === 0) { execute(cmdName, {}); return; }
    advance({ cmd: cmdName, args: { ...preset }, idx: 0 });
  }, [advance, describeVal, execute, print]);

  const supplyArg = useCallback((value) => {
    const p = pendingRef.current;
    if (!p) return;
    const arg = currentArg(p);
    print(`${promptText(p)}${describeVal(arg, value)}`, "cmd");
    advance({ ...p, args: { ...p.args, [arg.name]: value } });
  }, [advance, describeVal, print, promptText]);

  const abort = useCallback(() => {
    if (!pendingRef.current) return;
    print(`${promptText(pendingRef.current)}${typedRef.current} [Abort]`, "cmd");
    setPending(null); setTyped("");
  }, [print, promptText]);

  // ---- keyboard interactor -------------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (ctxMenu) { setCtxMenu(null); return; }
        abort(); return;
      }
      if (e.key === "Backspace") { setTyped((t) => t.slice(0, -1)); e.preventDefault(); return; }
      if (e.key === "Enter") {
        const p = pendingRef.current;
        const t = typedRef.current.trim();
        const g = graphRef.current;
        if (!p) {
          if (!t) return;
          const norm = (s) => s.toLowerCase().replace(/[-\s]+/g, " ");
          const hit = COMMANDS.find((c) => norm(c.name) === norm(t)) ||
            COMMANDS.find((c) => norm(c.name).startsWith(norm(t)));
          if (hit) { setTyped(""); startCommand(hit.name); }
          else { print(`command: ${t}`, "cmd"); print(`;;; unknown command "${t}". Type Help.`); setTyped(""); }
          return;
        }
        const arg = currentArg(p);
        if (!t) {
          const def = argDefault(arg, p);
          if (def != null) supplyArg(def);
          return;
        }
        if (arg.type === "number") {
          const v = parseFloat(t);
          if (isNaN(v)) { print(`;;; "${t}" is not a number.`); setTyped(""); return; }
          supplyArg(v);
        } else if (arg.type === "string") {
          supplyArg(t);
        } else if (arg.type === "choice") {
          const opts = argOptions(arg, p.args) || [];
          const hit = opts.find((o) => o.toLowerCase().startsWith(t.toLowerCase()));
          if (hit) supplyArg(hit);
          else { print(`;;; "${t}" is not one of ${opts.join(", ")}.`); setTyped(""); }
        } else if (arg.type === "unit") {
          const hit = g.nodes.find((n) => n.name.toLowerCase() === t.toLowerCase()) ||
            g.nodes.find((n) => n.name.toLowerCase().startsWith(t.toLowerCase()));
          if (hit) supplyArg(hit);
          else { print(`;;; no unit named "${t}".`); setTyped(""); }
        } else if (arg.type === "stream") {
          const hit = g.conns.find((c) => c.name.toLowerCase() === t.toLowerCase());
          if (hit) supplyArg(hit);
          else { print(`;;; no stream named "${t}".`); setTyped(""); }
        } else if (arg.type === "port") {
          const m = t.split(".");
          const n = g.nodes.find((x) => x.name.toLowerCase() === (m[0] || "").toLowerCase());
          const pd = n && TYPES[n.type].ports.find((x) => x.key.toLowerCase() === (m[1] || "").toLowerCase());
          if (n && pd && pd.dir === arg.dir) supplyArg({ nodeId: n.id, key: pd.key });
          else print(`;;; type ports as UNIT.PORT (e.g. T-1.IN), or click one.`);
          setTyped("");
        }
        return;
      }
      if (e.key.length === 1) {
        setTyped((t) => t + e.key);
        if (e.key === " ") e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abort, argDefault, ctxMenu, print, startCommand, supplyArg]);

  // ---- pointer handlers ------------------------------------------------------
  const canvasPos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left + canvasRef.current.scrollLeft, y: e.clientY - r.top + canvasRef.current.scrollTop };
  };

  const arg = currentArg(pending);
  const wantsUnit = arg?.type === "unit";
  const wantsPort = arg?.type === "port";
  const wantsStream = arg?.type === "stream";
  const wantsPosition = arg?.type === "position";
  const wantsChoice = arg?.type === "choice";

  const portEligible = (n, pd) => {
    if (!wantsPort) return false;
    if (pd.dir !== arg.dir) return false;
    if (arg.dir === "in" && pending.args["from port"] && pending.args["from port"].nodeId === n.id) return false;
    return true;
  };

  const onCanvasMouseDown = (e) => {
    if (e.button !== 0) return;
    setCtxMenu(null);
    if (wantsPosition) supplyArg(canvasPos(e));
  };
  const onCanvasContext = (e) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, kind: "canvas" });
  };

  const onUnitMouseDown = (n) => (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setCtxMenu(null);
    if (wantsUnit) { supplyArg(n); return; }
    if (wantsPosition) { supplyArg(canvasPos(e)); return; }
    if (pending) return;
    dragRef.current = { id: n.id, start: canvasPos(e), orig: { ...n.pos }, moved: false };
    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const p = canvasPos(ev);
      const dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (d.moved)
        setGraph((gr) => ({ ...gr, nodes: gr.nodes.map((x) =>
          x.id === d.id ? { ...x, pos: { x: Math.max(0, d.orig.x + dx), y: Math.max(0, d.orig.y + dy) } } : x) }));
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (d && !d.moved) {
        const u = graphRef.current.nodes.find((x) => x.id === d.id);
        if (u) startCommand("Inspect", { unit: u });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onUnitContext = (n) => (e) => {
    e.preventDefault(); e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, kind: "unit", id: n.id });
  };

  const onPortMouseDown = (n, pd) => (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setCtxMenu(null);
    const ref = { nodeId: n.id, key: pd.key };
    if (wantsPort) {
      if (portEligible(n, pd)) supplyArg(ref);
      else print(`;;; ${pPort(n, pd.key)} is not a valid ${arg.name} here.`);
      return;
    }
    if (pending) return;
    // default gesture: start a connection from / to this port
    if (pd.dir === "out") startCommand("Manual Connect", { "from port": ref });
    else startCommand("Manual Connect", { "to port": ref });
  };

  const onStreamMouseDown = (c) => (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setCtxMenu(null);
    if (wantsStream) { supplyArg(c); return; }
    if (pending) return;
    startCommand("Describe Stream", { stream: c });
  };
  const onStreamContext = (c) => (e) => {
    e.preventDefault(); e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, kind: "stream", id: c.id });
  };

  // ---- pointer documentation ---------------------------------------------
  let doc;
  if (wantsPort) {
    const dirWord = arg.dir === "out" ? "output" : "input";
    doc = hover?.kind === "port" && portEligible(hover.n, hover.pd)
      ? `Mouse-L: select ${pPort(hover.n, hover.pd.key)} as the ${arg.name}.`
      : `Reading a ${arg.name.toUpperCase()} — ${dirWord} ports are mouse-sensitive. Type UNIT.PORT, RETURN for default, ESCAPE aborts.`;
  } else if (wantsUnit) {
    doc = hover?.kind === "unit"
      ? `Mouse-L: select ${pUnit(hover.n)} as the ${arg.name}.`
      : `Reading a UNIT — unit presentations are mouse-sensitive. RETURN accepts the default; ESCAPE aborts.`;
  } else if (wantsStream) {
    doc = hover?.kind === "stream"
      ? `Mouse-L: select ${pStream(hover.c)}.`
      : "Reading a STREAM — stream labels are mouse-sensitive. RETURN accepts the default; ESCAPE aborts.";
  } else if (wantsPosition) {
    doc = "Mouse-L: use this position.  ESCAPE aborts.";
  } else if (wantsChoice) {
    doc = `Choose ${arg.name} from the menu, or type its name and press RETURN.`;
  } else if (arg) {
    doc = `Type the ${arg.name} and press RETURN.  ESCAPE aborts.`;
  } else if (hover?.kind === "port") {
    doc = `Mouse-L: Manual Connect ${hover.pd.dir === "out" ? "from" : "to"} ${pPort(hover.n, hover.pd.key)}.  Mouse-R: menu.`;
  } else if (hover?.kind === "unit") {
    doc = `Mouse-L: Inspect ${hover.n.name} (drag to move).  Mouse-R: menu of operations on ${pUnit(hover.n)}.`;
  } else if (hover?.kind === "stream") {
    const nf = nodes.find((x) => x.id === hover.c.from.nodeId);
    doc = `${hover.c.name} = ${fmt(nf?.state.outs[hover.c.from.key])}.  Mouse-L: Describe.  Mouse-R: menu.`;
  } else {
    doc = "Mouse-L: drag units, click ports to connect.  Mouse-R: menu.";
  }

  const ctxUnit = ctxMenu?.kind === "unit" ? nodes.find((n) => n.id === ctxMenu.id) : null;
  const ctxStream = ctxMenu?.kind === "stream" ? conns.find((c) => c.id === ctxMenu.id) : null;
  const routes = conns.map((c) => ({ c, r: routeConn(nodes, c) })).filter((x) => x.r);
  const choiceOpts = wantsChoice ? argOptions(arg, pending.args) || [] : [];

  return (
    <div className={`dk-root ${flash ? "dk-flash" : ""} ${wantsPosition ? "dk-crosshair" : ""}`}>
      <style>{CSS}</style>

      <div className="dk-header">
        <div className="dk-hcell dk-inv dk-title">DESIGN KIT</div>
        <div className="dk-hcell dk-inv">GRAPHIC FLOWSHEETS</div>
        <div className="dk-hcell">MODELLING</div>
        <div className="dk-hcell">SIMULATION</div>
        <div className="dk-hcell">DATA-MODELS</div>
      </div>
      <div className="dk-header">
        <div className="dk-hcell dk-inv dk-title">PROCESS CONTROL</div>
        <div className="dk-hcell">GRAPHIC-CONT.&-INST.</div>
        <div className="dk-hcell">RULE-BASES</div>
        <div className="dk-hcell">DATA-BASES</div>
        <div className="dk-hcell">EXTERNAL-WORLD</div>
      </div>

      <div className="dk-main">
        <div ref={canvasRef} className="dk-canvas"
          onMouseDown={onCanvasMouseDown}
          onContextMenu={onCanvasContext}
          onMouseEnter={() => setHover({ kind: "canvas" })}
          onMouseLeave={() => setHover(null)}>

          <svg className="dk-edges">
            <defs>
              <marker id="dk-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                <path d="M0,0 L7,3 L0,6 z" fill="#000" />
              </marker>
            </defs>
            {routes.map(({ c, r }) => (
              <polyline key={c.id}
                points={r.pts.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none" stroke="#000" strokeWidth="1.5" markerEnd="url(#dk-arrow)" />
            ))}
          </svg>

          {/* stream labels (clickable presentations) */}
          {routes.map(({ c, r }) => (
            <div key={`lbl${c.id}`}
              className={`dk-slabel ${wantsStream ? "dk-sensitive" : ""}`}
              style={{ left: r.mid.x + 4, top: r.mid.y - 8 }}
              onMouseDown={onStreamMouseDown(c)}
              onContextMenu={onStreamContext(c)}
              onMouseEnter={() => setHover({ kind: "stream", c })}
              onMouseLeave={() => setHover({ kind: "canvas" })}>
              {c.name.toLowerCase()}
            </div>
          ))}

          {/* units */}
          {nodes.map((n) => {
            const t = TYPES[n.type];
            return (
              <div key={n.id}
                className={`dk-unit ${wantsUnit ? "dk-sensitive" : ""}`}
                style={{ left: n.pos.x, top: n.pos.y, width: t.w }}
                onMouseDown={onUnitMouseDown(n)}
                onContextMenu={onUnitContext(n)}
                onMouseEnter={() => setHover({ kind: "unit", n })}
                onMouseLeave={() => setHover({ kind: "canvas" })}>
                <div className="dk-shapebox" style={{ width: t.w, height: t.h }}>
                  <Shape n={n} />
                  {t.ports.map((pd) => (
                    <div key={pd.key}
                      className={[
                        "dk-port",
                        pd.dir === "out" ? "dk-port-out" : "dk-port-in",
                        wantsPort ? (portEligible(n, pd) ? "dk-port-hot" : "dk-port-cold") : "",
                      ].join(" ")}
                      style={{ left: pd.x * t.w - 5, top: pd.y * t.h - 5 }}
                      onMouseDown={onPortMouseDown(n, pd)}
                      onContextMenu={onUnitContext(n)}
                      onMouseEnter={(e) => { e.stopPropagation(); setHover({ kind: "port", n, pd }); }}
                      onMouseLeave={() => setHover({ kind: "unit", n })}
                      title={`${n.name}.${pd.key}`} />
                  ))}
                </div>
                <div className="dk-caption">
                  {!(n.type === "SETPOINT" || n.type === "SOURCE" || n.type === "PID" || n.type === "SENSOR") && <span>{n.name}</span>}
                  <span className="dk-capval">
                    {fmt(Object.values(n.state.outs)[0])}
                  </span>
                </div>
              </div>
            );
          })}

          {nodes.length === 0 && (
            <div className="dk-empty">Screen erased. Add units from PROCESS UNITS or CONTROL.&amp; INSTRUM., then Manual-Connect their ports.</div>
          )}
        </div>

        <div className="dk-menus">
          {MENU_GROUPS.map((g) => (
            <div key={g.title}>
              <div className="dk-menu-title">{g.title}</div>
              {g.items.map((it) => (
                <div key={it.label} className="dk-menu-item"
                  onClick={() => startCommand(it.action.cmd, it.action.preset || {})}>
                  <span className="dk-menu-arrow">{it.pointer ? "<----" : ""}</span>
                  <span>{it.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="dk-interactor" ref={interactorRef}>
        {lines.map((l, i) => (
          <div key={i} className={l.t === "cmd" ? "dk-line-cmd" : "dk-line-out"}>{l.s}</div>
        ))}
        <div className="dk-line-cmd">
          {promptText(pending)}
          <span>{typed}</span>
          <span className="dk-cursor" />
        </div>
      </div>

      <div className="dk-doc">
        <div>{doc}</div>
        <div>To see other commands, press Shift, Control, Control-Shift, Meta-Shift, or Super.</div>
      </div>

      <div className="dk-status">
        <span>[{clock}]</span>
        <span>claude</span>
        <span>CL-USER:</span>
        <span className="dk-status-mode">{pending ? `${pending.cmd} — reading ${currentArg(pending)?.name}` : "User Input"}</span>
        <span className="dk-status-right">
          {running ? "SIMULATION RUNNING" : "SIMULATION HALTED"} · t={simTime.toFixed(1)}s · PLANT serving RK-EULER
        </span>
      </div>

      {ctxMenu && (
        <div className="dk-ctx" style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onContextMenu={(e) => e.preventDefault()}>
          <div className="dk-ctx-title">
            {ctxUnit ? pUnit(ctxUnit) : ctxStream ? pStream(ctxStream) : "CANVAS"}
          </div>
          {ctxUnit && UNIT_CONTEXT.map((c) => (
            <div key={c} className="dk-menu-item" onClick={() => startCommand(c, { unit: ctxUnit })}>
              <span className="dk-menu-arrow">{findCommand(c).pointer ? "<----" : ""}</span>
              <span>{c}</span>
            </div>
          ))}
          {ctxUnit && TYPES[ctxUnit.type].ports.some((p) => p.dir === "out") && (
            <div className="dk-menu-item" onClick={() => {
              const pd = TYPES[ctxUnit.type].ports.find((p) => p.dir === "out");
              startCommand("Manual Connect", { "from port": { nodeId: ctxUnit.id, key: pd.key } });
            }}>
              <span className="dk-menu-arrow">{"<----"}</span>
              <span>Connect From {ctxUnit.name}</span>
            </div>
          )}
          {ctxStream && STREAM_CONTEXT.map((c) => (
            <div key={c} className="dk-menu-item" onClick={() => startCommand(c, { stream: ctxStream })}>
              <span className="dk-menu-arrow">{findCommand(c).pointer ? "<----" : ""}</span>
              <span>{c}</span>
            </div>
          ))}
          {ctxMenu.kind === "canvas" && CANVAS_CONTEXT.map((c) => (
            <div key={c} className="dk-menu-item" onClick={() => startCommand(c)}>
              <span className="dk-menu-arrow">{findCommand(c).pointer ? "<----" : ""}</span>
              <span>{c}</span>
            </div>
          ))}
        </div>
      )}

      {wantsChoice && (
        <div className="dk-choice">
          <div className="dk-ctx-title">Choose {arg.name}</div>
          {choiceOpts.map((o) => (
            <div key={o} className="dk-menu-item" onClick={() => supplyArg(o)}>
              <span className="dk-menu-arrow" />
              <span>{TYPES[o] ? `${o} — ${TYPES[o].label}` : o}</span>
            </div>
          ))}
          <div className="dk-menu-item dk-dim" onClick={abort}>
            <span className="dk-menu-arrow" />
            <span>[Abort]</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- styles ---------------------------------------------------------
const CSS = `
.dk-root {
  --ink: #000;
  --paper: #fff;
  font-family: "Lucida Console", Monaco, "DejaVu Sans Mono", Menlo, monospace;
  font-size: 12px;
  line-height: 1.35;
  color: var(--ink);
  background: var(--paper);
  height: 100vh;
  display: flex;
  flex-direction: column;
  user-select: none;
  cursor: default;
}
.dk-root * { box-sizing: border-box; }
.dk-flash { filter: invert(1); }
.dk-crosshair, .dk-crosshair .dk-canvas, .dk-crosshair .dk-unit { cursor: crosshair !important; }

.dk-header { display: flex; border-bottom: 2px solid var(--ink); }
.dk-hcell {
  flex: 1; padding: 4px 8px; border-right: 2px solid var(--ink);
  border-top: 2px solid var(--ink); font-weight: bold; letter-spacing: 0.5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dk-hcell:first-child { border-left: 2px solid var(--ink); }
.dk-title { flex: 0 0 175px; font-size: 14px; }
.dk-inv { background: var(--ink); color: var(--paper); }

.dk-main { flex: 1; display: flex; min-height: 0; }
.dk-canvas {
  flex: 1; position: relative; overflow: auto;
  background-image: radial-gradient(#00000012 1px, transparent 1px);
  background-size: 14px 14px;
  border-left: 2px solid var(--ink);
}
.dk-edges { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.dk-empty { position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%); text-align: center; max-width: 400px; opacity: 0.6; }

.dk-unit { position: absolute; }
.dk-shapebox { position: relative; }
.dk-shape { display: block; background: transparent; }
.dk-caption {
  display: flex; justify-content: center; gap: 8px; font-weight: bold; font-size: 11px;
  padding-top: 1px; white-space: nowrap;
}
.dk-capval { font-weight: normal; }

.dk-port {
  position: absolute; width: 10px; height: 10px; border: 2px solid var(--ink);
  background: var(--paper); cursor: pointer; z-index: 3;
}
.dk-port-out { background: var(--ink); }
.dk-port-hot { outline: 2px dashed var(--ink); outline-offset: 2px; animation: dk-blink 0.7s steps(1) infinite; }
.dk-port-cold { opacity: 0.25; cursor: default; }

.dk-slabel {
  position: absolute; padding: 0 3px; background: var(--paper); border: 1px solid transparent;
  font-size: 11px; cursor: pointer; z-index: 2;
}
.dk-slabel:hover { border-color: var(--ink); }

.dk-sensitive { outline: 2px dashed var(--ink); outline-offset: 3px; animation: dk-blink 0.7s steps(1) infinite; cursor: pointer !important; }
@keyframes dk-blink { 50% { outline-color: transparent; } }

.dk-menus { flex: 0 0 205px; border-left: 2px solid var(--ink); overflow-y: auto; background: var(--paper); }
.dk-menu-title {
  background: var(--ink); color: var(--paper); font-weight: bold; padding: 2px 6px;
  border-top: 2px solid var(--ink); letter-spacing: 0.5px;
}
.dk-menu-item { display: flex; gap: 4px; padding: 1px 6px; white-space: nowrap; cursor: pointer; }
.dk-menu-item:hover { background: var(--ink); color: var(--paper); }
.dk-menu-arrow { flex: 0 0 38px; letter-spacing: -1px; }
.dk-dim { opacity: 0.65; }

.dk-interactor {
  flex: 0 0 122px; overflow-y: auto; border-top: 2px solid var(--ink);
  padding: 3px 8px; background: var(--paper); user-select: text; cursor: text;
}
.dk-line-cmd { font-weight: bold; }
.dk-cursor {
  display: inline-block; width: 8px; height: 13px; background: var(--ink);
  vertical-align: text-bottom; animation: dk-blink 1s steps(1) infinite;
}

.dk-doc { background: var(--ink); color: var(--paper); padding: 2px 8px; font-weight: bold; min-height: 34px; }
.dk-status { display: flex; gap: 18px; padding: 2px 8px; border-top: 2px solid var(--ink); background: var(--paper); }
.dk-status-mode { text-decoration: underline; }
.dk-status-right { margin-left: auto; }

.dk-ctx, .dk-choice {
  position: fixed; z-index: 50; background: var(--paper); border: 2px solid var(--ink);
  box-shadow: 4px 4px 0 var(--ink); min-width: 230px; max-width: 340px;
}
.dk-choice { left: 50%; top: 38%; transform: translate(-50%, -50%); }
.dk-ctx-title {
  background: var(--ink); color: var(--paper); font-weight: bold; padding: 2px 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

@media (prefers-reduced-motion: reduce) {
  .dk-sensitive, .dk-cursor, .dk-port-hot { animation: none; }
}
`;

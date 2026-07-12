import React, {
  useState, useEffect, useRef, useReducer, useCallback,
  createContext, useContext,
} from "react";

/* ============================================================
   SCHEMA-1 — a Genera / Dynamic-Windows / CLIM style
   presentation-based SCHEMATIC EDITOR with a built-in
   switch-level "SPICE" simulator, after the Symbolics
   NS CAD screenshot (TEST-CARRY-1).

   • Transistors, wires, pads, pins — every drawn object is a
     typed presentation that stays mouse-sensitive.
   • Right-click any presentation → menu of commands applicable
     to its type (instance / node / wire / pane / …).
   • Commands prompt for missing arguments in the Listener;
     while accepting an argument of type T only presentations
     of type T stay live, everything else dims. Click to supply,
     or type. [Escape] aborts.
   • :Spice runs a 5-corner sweep of the actual drawn network
     (Reduced-Worst-Speed … Worst-power) and plots probed nodes
     in the waveform panes, SPICE-plot style.
   ============================================================ */

const INK = "#000", PAPER = "#fff";
const FONT = "'IBM Plex Mono','Menlo','Consolas',monospace";
const G = 20;                       // virtual grid pitch
const snap = (v) => Math.round(v / G) * G;
const DASHES = ["", "7 4", "2 4", "10 3 2 3", "1 3", "5 2 1 2"];

/* ------------------- component library ------------------- */

const KINDS = ["nmos", "pmos", "cap", "res", "pad", "vdd", "gnd"];

const PIN_DEFS = {
  nmos: [{ n: "G", x: -40, y: 0 }, { n: "D", x: 0, y: -40 }, { n: "S", x: 0, y: 40 }],
  pmos: [{ n: "G", x: -40, y: 0 }, { n: "S", x: 0, y: -40 }, { n: "D", x: 0, y: 40 }],
  cap:  [{ n: "A", x: 0, y: -20 }, { n: "B", x: 0, y: 20 }],
  res:  [{ n: "A", x: 0, y: -20 }, { n: "B", x: 0, y: 20 }],
  pad:  [{ n: "P", x: 20, y: 0 }],
  vdd:  [{ n: "P", x: 0, y: 20 }],
  gnd:  [{ n: "P", x: 0, y: -20 }],
};

const DEFAULT_PARAMS = {
  nmos: { wl: "8/1" }, pmos: { wl: "12/1" },
  cap: { val: "0.2" }, res: { val: "10" },
  pad: { name: "IN" }, vdd: {}, gnd: {},
};

const rot = (x, y, r) => {
  if (r === 90) return [-y, x];
  if (r === 180) return [-x, -y];
  if (r === 270) return [y, -x];
  return [x, y];
};

const pinsOf = (inst) =>
  PIN_DEFS[inst.kind].map((p) => {
    const [dx, dy] = rot(p.x, p.y, inst.rot || 0);
    return { name: p.n, x: inst.x + dx, y: inst.y + dy };
  });

const instLabel = (inst) =>
  inst.kind === "pad" ? `PAD ${inst.params.name}` :
  inst.kind === "vdd" ? "VDD" : inst.kind === "gnd" ? "GND" :
  `${inst.id} (${inst.kind.toUpperCase()} ${inst.params.wl || inst.params.val || ""})`;

/* driven waveforms for known pad names (t in ns) */
const SOURCES = {
  PHI1: (t) => (t % 4 < 2 ? 5 : 0),
  PHI2: (t) => (t % 4 < 2 ? 0 : 5),
  "-PHI1": (t) => (t % 4 < 2 ? 0 : 5),
  IN:  (t) => { const p = t % 8; return p >= 1 && p < 5 ? 5 : 0; },
  SIN: (t) => { const p = t % 8; return p >= 1 && p < 5 ? 5 : 0; },
  PIN: (t) => { const p = t % 8; return p >= 3 && p < 7 ? 5 : 0; },
};

/* ------------------- netlist extraction ------------------- */

const key = (x, y) => `${x},${y}`;

function onSegment(px, py, w) {
  const minx = Math.min(w.x1, w.x2), maxx = Math.max(w.x1, w.x2);
  const miny = Math.min(w.y1, w.y2), maxy = Math.max(w.y1, w.y2);
  if (px < minx - 1 || px > maxx + 1 || py < miny - 1 || py > maxy + 1) return false;
  const cross = (w.x2 - w.x1) * (py - w.y1) - (w.y2 - w.y1) * (px - w.x1);
  return Math.abs(cross) < 1;
}

function buildNetlist(instances, wires) {
  const idx = new Map(); const parent = [];
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { parent[find(a)] = find(b); };
  const pt = (x, y) => {
    const k = key(x, y);
    if (!idx.has(k)) { idx.set(k, parent.length); parent.push(parent.length); }
    return idx.get(k);
  };

  instances.forEach((inst) => pinsOf(inst).forEach((p) => pt(p.x, p.y)));
  wires.forEach((w) => union(pt(w.x1, w.y1), pt(w.x2, w.y2)));
  // T-junctions: any registered point lying on a wire joins it
  for (const [k, i] of idx) {
    const [px, py] = k.split(",").map(Number);
    wires.forEach((w) => { if (onSegment(px, py, w)) union(i, pt(w.x1, w.y1)); });
  }

  // group roots → nodes
  const rootToNode = new Map(); const nodes = [];
  const nodeAt = (x, y) => {
    const k = key(x, y);
    if (!idx.has(k)) return -1;
    const r = find(idx.get(k));
    if (!rootToNode.has(r)) {
      rootToNode.set(r, nodes.length);
      nodes.push({ name: null, kind: "internal", pins: [] });
    }
    return rootToNode.get(r);
  };

  instances.forEach((inst) => pinsOf(inst).forEach((p) => {
    const n = nodeAt(p.x, p.y);
    nodes[n].pins.push({ inst, pin: p.name });
  }));
  wires.forEach((w) => { w.node = nodeAt(w.x1, w.y1); });

  // naming: VDD / GND / pad name / N#
  nodes.forEach((nd) => {
    if (nd.pins.some((p) => p.inst.kind === "vdd")) { nd.name = "VDD"; nd.kind = "vdd"; }
    else if (nd.pins.some((p) => p.inst.kind === "gnd")) { nd.name = "GND"; nd.kind = "gnd"; }
  });
  nodes.forEach((nd) => {
    if (nd.name) return;
    const pad = nd.pins.find((p) => p.inst.kind === "pad");
    if (pad) { nd.name = pad.inst.params.name; nd.kind = SOURCES[nd.name] ? "driven" : "internal"; }
  });
  let n = 1;
  nodes.forEach((nd) => { if (!nd.name) nd.name = "N" + n++; });

  const nodeOfPin = (inst, pinName) => {
    const p = pinsOf(inst).find((q) => q.name === pinName);
    return nodeAt(p.x, p.y);
  };

  const devices = instances
    .filter((i) => ["nmos", "pmos", "cap", "res"].includes(i.kind))
    .map((i) => ({
      inst: i, kind: i.kind,
      a: nodeOfPin(i, PIN_DEFS[i.kind][i.kind === "cap" || i.kind === "res" ? 0 : 1].n),
      b: nodeOfPin(i, PIN_DEFS[i.kind][i.kind === "cap" || i.kind === "res" ? 1 : 2].n),
      g: i.kind === "nmos" || i.kind === "pmos" ? nodeOfPin(i, "G") : -1,
    }));

  return { nodes, devices, nodeAt };
}

/* ------------------- switch-level simulator ------------------- */

const CORNERS = [
  { name: "Reduced-Worst-Speed", k: 0.5 },
  { name: "Worst-speed-HP-Model", k: 0.7 },
  { name: "Typical-HP-Model", k: 1.0 },
  { name: "Worst-power-HP-Model", k: 1.35 },
  { name: "Fast-Fast", k: 1.7 },
];
const VDD = 5, VTH = 1, TEND = 10, DT = 0.005, RECORD = 5;

function runSpice(net) {
  const N = net.nodes.length;
  const wl = (inst) => {
    const m = /([\d.]+)\s*\/\s*([\d.]+)/.exec(inst.params.wl || "1/1");
    return m ? parseFloat(m[1]) / parseFloat(m[2]) : 1;
  };
  // node capacitance: base + gate loads + explicit caps (grounded-cap approx)
  const C = new Array(N).fill(1);
  net.devices.forEach((d) => {
    if (d.kind === "nmos" || d.kind === "pmos") C[d.g] += 0.6 + wl(d.inst) * 0.02;
    if (d.kind === "cap") { const v = parseFloat(d.inst.params.val) || 0.1; C[d.a] += v * 20; C[d.b] += v * 20; }
  });

  const driven = net.nodes.map((nd) =>
    nd.kind === "vdd" ? () => VDD :
    nd.kind === "gnd" ? () => 0 :
    SOURCES[nd.name] ? SOURCES[nd.name] : null);

  const steps = Math.round(TEND / DT);
  const t = []; const data = net.nodes.map(() => CORNERS.map(() => []));

  CORNERS.forEach((corner, ci) => {
    const K = 0.55 * corner.k;
    const V = net.nodes.map((nd, i) => (driven[i] ? driven[i](0) : 0));
    for (let s = 0; s <= steps; s++) {
      const time = s * DT;
      for (let i = 0; i < N; i++) if (driven[i]) V[i] = driven[i](time);
      const dv = new Array(N).fill(0);
      net.devices.forEach((d) => {
        let g = 0;
        if (d.kind === "res") g = 2 / (parseFloat(d.inst.params.val) || 10);
        else if (d.kind === "nmos") {
          const ov = V[d.g] - Math.min(V[d.a], V[d.b]) - VTH;
          g = K * wl(d.inst) * Math.max(0, Math.min(1, ov / (VDD - VTH)));
        } else if (d.kind === "pmos") {
          const ov = Math.max(V[d.a], V[d.b]) - V[d.g] - VTH;
          g = K * wl(d.inst) * Math.max(0, Math.min(1, ov / (VDD - VTH)));
        } else return; // cap handled via C
        const f = g * (V[d.b] - V[d.a]);
        dv[d.a] += f; dv[d.b] -= f;
      });
      for (let i = 0; i < N; i++)
        if (!driven[i]) V[i] = Math.max(-0.5, Math.min(5.5, V[i] + (DT / C[i]) * dv[i]));
      if (s % RECORD === 0) {
        if (ci === 0) t.push(time);
        for (let i = 0; i < N; i++) data[i][ci].push(V[i]);
      }
    }
  });

  const byName = {};
  net.nodes.forEach((nd, i) => { byName[nd.name] = data[i]; });
  return { t, byName, nodeCount: N, devCount: net.devices.length };
}

/* ------------------- command table ------------------- */

const COMMANDS = {
  "Draw Instance": {
    args: [{ type: "component-type", name: "component type" }, { type: "location", name: "location" }],
    doc: "Place a component: choose a type from the menu, then click a grid location.",
  },
  "Draw Wire": {
    args: [{ type: "location", name: "from point" }, { type: "location", name: "to point" }],
    doc: "Draw a wire segment between two grid points. Chains until [Escape].",
  },
  "Move Instance": {
    args: [{ type: "instance", name: "instance" }, { type: "location", name: "new location" }],
    doc: "Pick up an instance and put it down elsewhere.",
  },
  "Rotate Instance": {
    args: [{ type: "instance", name: "instance" }],
    doc: "Rotate an instance 90 degrees.",
  },
  "Delete Instance": {
    args: [{ type: "instance", name: "instance" }],
    doc: "Remove an instance from the schematic.",
  },
  "Delete Wire": {
    args: [{ type: "wire", name: "wire" }],
    doc: "Remove a wire segment.",
  },
  "Edit Parameters": {
    args: [{ type: "instance", name: "instance" }, { type: "string", name: "value (e.g. 24/1)" }],
    doc: "Change W/L of a transistor, value of a cap or resistor, or the name of a pad.",
  },
  "Describe Instance": {
    args: [{ type: "instance", name: "instance" }],
    doc: "Print an instance's parameters and the node attached to each pin.",
  },
  "Probe Node": {
    args: [{ type: "node", name: "node" }, { type: "pane", name: "chart pane", default: 1 }],
    doc: "Attach a probe: the node's waveform is plotted after the next :Spice run.",
  },
  "Spice": {
    args: [],
    doc: "Extract the netlist and run a 5-corner switch-level simulation of the drawn network.",
  },
  "Clear Pane": {
    args: [{ type: "pane", name: "chart pane", default: 1 }],
    doc: "Remove all probes and traces from a chart pane.",
  },
  "Clear Schematic": { args: [], doc: "Erase every instance and wire." },
  "Clear Listener": { args: [], doc: "Erase the Listener's output history." },
};

const UICtx = createContext(null);

/* ------------------- presentations ------------------- */

function firstCmdFor(type) {
  return Object.keys(COMMANDS).find((c) => COMMANDS[c].args[0]?.type === type);
}

/* HTML presentation (listener text, pane headers, command strip) */
function Pres({ type, obj, label, children, block, dimmable = true, style }) {
  const ui = useContext(UICtx);
  const [hover, setHover] = useState(false);
  const at = ui.accept ? ui.accept.argType : null;
  const live = at === type;
  const dim = at && !live && dimmable;
  const name = label || (obj && (obj.name || obj.id)) || String(obj);
  return (
    <span
      style={{
        display: block ? "block" : "inline-block", position: "relative",
        cursor: live || !at ? "pointer" : "default",
        outline: hover && (live || !at) ? `2px solid ${INK}` : live ? `1px dashed ${INK}` : "2px solid transparent",
        outlineOffset: 1, opacity: dim ? 0.35 : 1, transition: "opacity 120ms", ...style,
      }}
      onMouseEnter={(e) => {
        setHover(true); e.stopPropagation();
        ui.setDoc(live
          ? `L: use ${name} as the ${ui.accept.argName} for ${ui.accept.cmd}.`
          : at ? `Accepting a ${at.toUpperCase()} — not applicable here.  [Escape] aborts.`
          : `${type.toUpperCase()} ${name} —  L: ${firstCmdFor(type) || "Select"};  R: Menu.`);
      }}
      onMouseLeave={() => { setHover(false); ui.setDoc(null); }}
      onMouseMove={(e) => e.stopPropagation()}
      onClick={(e) => {
        if (live) { e.stopPropagation(); ui.acceptObject(obj, type); }
        else if (!at) { e.stopPropagation(); ui.defaultAction(type, obj); }
      }}
      onContextMenu={(e) => {
        e.preventDefault(); e.stopPropagation();
        ui.openMenu(e.clientX, e.clientY, { type, obj, name });
      }}
    >{children}</span>
  );
}

/* SVG presentation (schematic objects) */
function SPres({ type, obj, name, bounds, children }) {
  const ui = useContext(UICtx);
  const [hover, setHover] = useState(false);
  const at = ui.accept ? ui.accept.argType : null;
  const live = at === type;
  const dim = at && !live && at !== "location";
  return (
    <g
      opacity={dim ? 0.3 : 1}
      style={{ cursor: live || !at ? "pointer" : at === "location" ? "crosshair" : "default" }}
      onMouseEnter={() => ui.setDoc(live
        ? `L: use ${name} as the ${ui.accept.argName} for ${ui.accept.cmd}.`
        : at === "location" ? null
        : at ? `Accepting a ${at.toUpperCase()} — not applicable.  [Escape] aborts.`
        : `${type.toUpperCase()} ${name} —  L: ${firstCmdFor(type) || "Select"};  R: Menu.`)}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseLeave={() => ui.setDoc(null)}
      onClick={(e) => {
        if (live) { e.stopPropagation(); ui.acceptObject(obj, type); }
        else if (!at) { e.stopPropagation(); ui.defaultAction(type, obj); }
        /* while accepting something else (e.g. a location) let the click fall through to the canvas */
      }}
      onContextMenu={(e) => {
        if (at === "location") return; // canvas handles placement menus
        e.preventDefault(); e.stopPropagation();
        ui.openMenu(e.clientX, e.clientY, { type, obj, name });
      }}
    >
      <rect x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h}
        fill="#000" fillOpacity="0" pointerEvents="all" />
      {children}
      {(hover && (live || !at)) &&
        <rect x={bounds.x - 2} y={bounds.y - 2} width={bounds.w + 4} height={bounds.h + 4}
          fill="none" stroke={INK} strokeWidth="1.8" pointerEvents="none" />}
      {live && !hover &&
        <rect x={bounds.x - 2} y={bounds.y - 2} width={bounds.w + 4} height={bounds.h + 4}
          fill="none" stroke={INK} strokeWidth="1" strokeDasharray="4 3" pointerEvents="none" />}
    </g>
  );
}

/* ------------------- schematic symbols ------------------- */

function Symbol({ inst, ghost }) {
  const k = inst.kind, p = inst.params || {};
  const S = { stroke: INK, strokeWidth: 1.6, fill: "none" };
  const body = () => {
    switch (k) {
      case "nmos": case "pmos": return (<>
        <line x1={-40} y1={0} x2={k === "pmos" ? -23 : -15} y2={0} {...S} />
        {k === "pmos" && <circle cx={-19} cy={0} r={4} {...S} />}
        <line x1={-15} y1={-13} x2={-15} y2={13} {...S} strokeWidth={2.4} />
        <line x1={-8} y1={-16} x2={-8} y2={16} {...S} strokeWidth={2.4} />
        <polyline points="-8,-12 0,-12 0,-40" {...S} />
        <polyline points="-8,12 0,12 0,40" {...S} />
        <text x={6} y={4} fontSize="10" fontFamily={FONT} fill={INK}>{p.wl}</text>
        <text x={6} y={-8} fontSize="8" fontFamily={FONT} fill={INK} opacity="0.65">{inst.id}</text>
      </>);
      case "cap": return (<>
        <line x1={0} y1={-20} x2={0} y2={-4} {...S} />
        <line x1={0} y1={20} x2={0} y2={4} {...S} />
        <line x1={-10} y1={-4} x2={10} y2={-4} {...S} strokeWidth={2.2} />
        <line x1={-10} y1={4} x2={10} y2={4} {...S} strokeWidth={2.2} />
        <text x={13} y={4} fontSize="9" fontFamily={FONT} fill={INK}>{p.val}pF</text>
      </>);
      case "res": return (<>
        <line x1={0} y1={-20} x2={0} y2={-13} {...S} />
        <line x1={0} y1={20} x2={0} y2={13} {...S} />
        <rect x={-6} y={-13} width={12} height={26} {...S} />
        <text x={10} y={4} fontSize="9" fontFamily={FONT} fill={INK}>{p.val}k</text>
      </>);
      case "pad": return (<>
        <rect x={-8} y={-8} width={16} height={16} {...S} />
        <rect x={-4} y={-4} width={8} height={8} fill={INK} />
        <line x1={8} y1={0} x2={20} y2={0} {...S} />
        <text x={-13} y={4} fontSize="10" fontFamily={FONT} fill={INK} textAnchor="end"
          transform={inst.rot ? `rotate(${-inst.rot} -13 0)` : undefined}>{p.name}</text>
      </>);
      case "vdd": return (<>
        <line x1={0} y1={20} x2={0} y2={2} {...S} />
        <line x1={-9} y1={2} x2={9} y2={2} {...S} strokeWidth={2.2} />
        <text x={0} y={-4} fontSize="8" fontFamily={FONT} fill={INK} textAnchor="middle">VDD</text>
      </>);
      case "gnd": return (<>
        <line x1={0} y1={-20} x2={0} y2={-6} {...S} />
        <polygon points="-9,-6 9,-6 0,6" {...S} />
      </>);
      default: return null;
    }
  };
  return (
    <g transform={`translate(${inst.x},${inst.y}) rotate(${inst.rot || 0})`} opacity={ghost ? 0.4 : 1}>
      {body()}
    </g>
  );
}

const BOUNDS = {
  nmos: { x: -44, y: -42, w: 74, h: 84 }, pmos: { x: -44, y: -42, w: 74, h: 84 },
  cap: { x: -14, y: -22, w: 52, h: 44 }, res: { x: -12, y: -22, w: 44, h: 44 },
  pad: { x: -44, y: -12, w: 66, h: 24 }, vdd: { x: -12, y: -14, w: 24, h: 36 },
  gnd: { x: -12, y: -22, w: 24, h: 30 },
};
const boundsOf = (inst) => {
  const b = BOUNDS[inst.kind];
  const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]
    .map(([x, y]) => rot(x, y, inst.rot || 0));
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  return { x: inst.x + Math.min(...xs), y: inst.y + Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

/* ------------------- preloaded circuit ------------------- */
/* dynamic pass-gate stage + two CMOS inverters, like the CADR/NS demo */

let IDC = { mos: 0, cap: 0, res: 0, pad: 0, vdd: 0, gnd: 0 };
const mk = (kind, x, y, extra = {}) => {
  const bucket = kind === "nmos" || kind === "pmos" ? "mos" : kind;
  IDC[bucket]++;
  const prefix = { mos: "M", cap: "C", res: "R", pad: "P", vdd: "V", gnd: "GN" }[bucket];
  return { id: prefix + IDC[bucket], kind, x, y, rot: 0, params: { ...DEFAULT_PARAMS[kind] }, ...extra };
};

function preload() {
  IDC = { mos: 0, cap: 0, res: 0, pad: 0, vdd: 0, gnd: 0 };
  const I = [];
  I.push(mk("pad", 60, 240, { params: { name: "SIN" } }));
  I.push(mk("pad", 140, 120, { params: { name: "PHI1" } }));
  I.push(mk("nmos", 160, 240, { rot: 90, params: { wl: "24/1" } }));   // pass gate
  I.push(mk("cap", 200, 300, { params: { val: "0.2" } }));
  I.push(mk("gnd", 200, 340));
  I.push(mk("pmos", 280, 160, { params: { wl: "12/1" } }));            // inverter 1
  I.push(mk("nmos", 280, 280, { params: { wl: "14/1" } }));
  I.push(mk("vdd", 280, 100)); I.push(mk("gnd", 280, 340));
  I.push(mk("pmos", 380, 160, { params: { wl: "12/1" } }));            // inverter 2
  I.push(mk("nmos", 380, 280, { params: { wl: "14/1" } }));
  I.push(mk("vdd", 380, 100)); I.push(mk("gnd", 380, 340));
  I.push(mk("pad", 460, 220, { rot: 180, params: { name: "SOUT" } }));
  const W = [
    [80, 240, 120, 240], [160, 120, 160, 200], [200, 240, 240, 240],
    [200, 240, 200, 280],
    [240, 160, 240, 280], [280, 200, 280, 240], [280, 220, 340, 220],
    [340, 160, 340, 280], [380, 200, 380, 240], [380, 220, 440, 220],
  ].map(([x1, y1, x2, y2], i) => ({ id: "W" + (i + 1), x1, y1, x2, y2 }));
  return [I, W];
}

/* ------------------- waveform pane ------------------- */

function WavePane({ pane, sim }) {
  const W = 560, H = 250, PL = 40, PR = 12, PT = 8, PB = 22;
  const x = (tn) => PL + (tn / TEND) * (W - PL - PR);
  const y = (v) => PT + (1 - (v + 1) / 7) * (H - PT - PB);   // -1 .. 6 V

  return (
    <Pres type="pane" obj={pane} label={`PANE-${pane.id}`} block dimmable={false}
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ background: INK, color: PAPER, padding: "1px 8px", fontWeight: 700, fontSize: 12, display: "flex", justifyContent: "space-between" }}>
        <span>TEST-CARRY-1&nbsp;&nbsp;{new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" })}&nbsp;&nbsp;{pane.corner}</span>
        <span>PANE {pane.id}</span>
      </div>
      <div style={{ padding: "2px 8px", fontSize: 11, borderBottom: `1px solid ${INK}`, minHeight: 20 }}>
        {pane.probes.length === 0 && <span style={{ opacity: 0.55 }}>No probes — Probe Node, or right-click a pin.</span>}
        {pane.probes.map((n, i) => (
          <span key={n} style={{ marginRight: 12 }}>
            <svg width="24" height="8" style={{ verticalAlign: "middle", marginRight: 3 }}>
              <line x1="0" y1="4" x2="24" y2="4" stroke={INK} strokeWidth="2" strokeDasharray={DASHES[i % DASHES.length]} />
            </svg>
            <Pres type="node" obj={{ name: n }}>{n}</Pres>
          </span>
        ))}
        {!sim && pane.probes.length > 0 && <span style={{ opacity: 0.55 }}>&nbsp;— run :Spice</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", flex: 1, display: "block", background: PAPER }} preserveAspectRatio="none">
        {[-1, 0, 1, 2, 3, 4, 5, 6].map((v) => (
          <g key={v}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke={INK} strokeOpacity="0.28" strokeDasharray="2 5" />
            <text x={PL - 4} y={y(v) + 3} fontSize="8.5" textAnchor="end" fontFamily={FONT}>{v.toFixed(1)}</text>
          </g>
        ))}
        {[0, 2, 4, 6, 8, 10].map((tn) => (
          <g key={tn}>
            <line x1={x(tn)} x2={x(tn)} y1={PT} y2={H - PB} stroke={INK} strokeOpacity="0.28" strokeDasharray="2 5" />
            <text x={x(tn)} y={H - 10} fontSize="8.5" textAnchor="middle" fontFamily={FONT}>{tn.toFixed(1)}</text>
          </g>
        ))}
        <rect x={PL} y={PT} width={W - PL - PR} height={H - PT - PB} fill="none" stroke={INK} />
        <text x={W - PR} y={H - 1} fontSize="8.5" textAnchor="end" fontFamily={FONT}>X 1.0e-9</text>
        {sim && pane.probes.map((name, pi) => {
          const corners = sim.byName[name];
          if (!corners) return null;
          return corners.map((trace, ci) => (
            <path key={name + ci}
              d={trace.map((v, i) => `${i ? "L" : "M"}${x(sim.t[i]).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
              fill="none" stroke={INK} strokeWidth={ci === 2 ? 1.5 : 0.8}
              strokeDasharray={DASHES[pi % DASHES.length]} />
          ));
        })}
      </svg>
    </Pres>
  );
}

/* ------------------- schematic canvas ------------------- */

function Canvas({ instances, wires, net, accept, toPlaceGhost }) {
  const ui = useContext(UICtx);
  const svgRef = useRef(null);
  const [hp, setHp] = useState(null); // hover point (snapped) while accepting a location

  const toSvg = (e) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: snap(p.x), y: snap(p.y) };
  };

  const acceptingLoc = accept && accept.argType === "location";

  const nodeName = (x, y) => {
    const n = net.nodeAt(x, y);
    return n >= 0 ? net.nodes[n].name : null;
  };

  return (
    <svg
      ref={svgRef} viewBox="0 0 660 470"
      style={{ width: "100%", height: "100%", display: "block", background: PAPER, cursor: acceptingLoc ? "crosshair" : "default" }}
      onMouseMove={(e) => { if (acceptingLoc) setHp(toSvg(e)); }}
      onMouseLeave={() => setHp(null)}
      onClick={(e) => { if (acceptingLoc) ui.acceptObject(toSvg(e), "location"); }}
      onContextMenu={(e) => {
        e.preventDefault(); e.stopPropagation();
        ui.openCanvasMenu(e.clientX, e.clientY, toSvg(e));
      }}
      onMouseEnter={() => ui.setDoc(acceptingLoc
        ? `L: put the ${accept.argName} at the crosshair (grid ${G}).  [Escape] aborts.`
        : "SCHEMATIC — R: draw / command menu.  Hover objects for their handlers.")}
    >
      <defs>
        <pattern id="vgrid" width={G} height={G} patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="1.2" height="1.2" fill={INK} opacity="0.35" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="660" height="470" fill="url(#vgrid)" />

      {/* wires */}
      {wires.map((w) => {
        const nn = w.node !== undefined && w.node >= 0 ? net.nodes[w.node].name : "?";
        return (
          <SPres key={w.id} type="wire" obj={{ ...w, nodeName: nn }} name={`${w.id} (node ${nn})`}
            bounds={{ x: Math.min(w.x1, w.x2) - 3, y: Math.min(w.y1, w.y2) - 3, w: Math.abs(w.x2 - w.x1) + 6, h: Math.abs(w.y2 - w.y1) + 6 }}>
            <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke={INK} strokeWidth="1.7" />
          </SPres>
        );
      })}

      {/* instances */}
      {instances.map((inst) => (
        <SPres key={inst.id} type="instance" obj={inst} name={instLabel(inst)} bounds={boundsOf(inst)}>
          <Symbol inst={inst} />
        </SPres>
      ))}

      {/* pins as node presentations */}
      {instances.map((inst) => pinsOf(inst).map((p) => {
        const nn = nodeName(p.x, p.y);
        return (
          <SPres key={inst.id + p.name} type="node" obj={{ name: nn }} name={`${nn} (pin ${inst.id}.${p.name})`}
            bounds={{ x: p.x - 4, y: p.y - 4, w: 8, h: 8 }}>
            <rect x={p.x - 2.5} y={p.y - 2.5} width="5" height="5" fill={INK} />
          </SPres>
        );
      }))}

      {/* placement ghost / rubber wire / crosshair */}
      {acceptingLoc && hp && (
        <g pointerEvents="none">
          <line x1={hp.x - 12} y1={hp.y} x2={hp.x + 12} y2={hp.y} stroke={INK} strokeWidth="1" />
          <line x1={hp.x} y1={hp.y - 12} x2={hp.x} y2={hp.y + 12} stroke={INK} strokeWidth="1" />
          {toPlaceGhost && toPlaceGhost.kind === "instance" &&
            <Symbol inst={{ ...toPlaceGhost.inst, x: hp.x, y: hp.y }} ghost />}
          {toPlaceGhost && toPlaceGhost.kind === "wire-from" &&
            <line x1={toPlaceGhost.from.x} y1={toPlaceGhost.from.y} x2={hp.x} y2={hp.y}
              stroke={INK} strokeWidth="1.2" strokeDasharray="5 4" />}
        </g>
      )}
    </svg>
  );
}

/* ============================================================
   APP
   ============================================================ */

export default function SchemaEditor() {
  const [[i0, w0]] = useState(preload);
  const [instances, setInstances] = useState(i0);
  const [wires, setWires] = useState(w0);
  const [panes, setPanes] = useState([
    { id: 1, probes: ["SIN", "SOUT"], corner: "Typical" },
    { id: 2, probes: ["PHI1", "N1"], corner: "Worst-speed" },
  ]);
  const [sim, setSim] = useState(null);
  const [lines, setLines] = useState([]);
  const [accept, setAccept] = useState(null);
  const [menu, setMenu] = useState(null);
  const [doc, setDoc] = useState(null);
  const [typed, setTyped] = useState("");
  const [clock, setClock] = useState(new Date());
  const scrollRef = useRef(null), inputRef = useRef(null);
  const wireCount = useRef(w0.length);

  const net = buildNetlist(instances, wires);

  const print = useCallback((parts) => {
    setLines((prev) => [...prev.slice(-300), { parts: Array.isArray(parts) ? parts : [parts] }]);
  }, []);

  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, accept, typed]);

  useEffect(() => {
    print("Schema 1.4 — presentation-based schematic capture, switch-level SPICE.");
    print("The drawing is live: every transistor, wire, and pin is a typed presentation.");
    print("Right-click objects for their commands; right-click empty canvas to draw.");
    print("While a command wants an argument, only matching presentations stay sensitive.");
    print(["Preloaded: SIN → pass NMOS (PHI1) → dynamic node → two inverters → SOUT.  Try  ", { bold: true, text: ":Spice" }]);
    print(" ");
  }, []); // eslint-disable-line

  /* -------- helpers -------- */
  const nodePres = (name) => ({ pres: "node", name });
  const findInst = (tok) => instances.find((i) => i.id.toUpperCase() === String(tok).toUpperCase()
    || (i.kind === "pad" && i.params.name.toUpperCase() === String(tok).toUpperCase()));
  const findNode = (tok) => net.nodes.find((n) => n.name.toUpperCase() === String(tok).toUpperCase());
  const paneId = (a) => (a && typeof a === "object" && "id" in a ? a.id : Number(a));

  const echoArg = (a) => {
    if (a == null) return "?";
    if (typeof a === "object") {
      if ("x" in a && "y" in a) return `(${a.x},${a.y})`;
      if ("probes" in a) return `pane ${a.id}`;
      if ("id" in a && "kind" in a) return a.id;
      if ("x1" in a) return a.id;
      if ("name" in a) return a.name;
      if ("id" in a) return `pane ${a.id}`;
    }
    return String(a);
  };

  /* -------- execution -------- */
  const execute = (cmd, args) => {
    print([{ bold: true, text: ":" + cmd + "  " }, args.map(echoArg).join("  ")]);
    switch (cmd) {
      case "Draw Instance": {
        const kind = args[0], loc = args[1];
        const inst = mk(kind, loc.x, loc.y);
        setInstances((I) => [...I, inst]);
        setSim(null);
        print([`Placed `, { bold: true, text: instLabel(inst) }, ` at (${loc.x},${loc.y}).`]);
        if (kind === "pad") print(`   Pads named PHI1, PHI2, -PHI1, IN, SIN, PIN are driven sources; others are observers. Use Edit Parameters to rename.`);
        break;
      }
      case "Draw Wire": {
        const [a, b] = args;
        if (a.x === b.x && a.y === b.y) { print("Zero-length wire ignored."); break; }
        wireCount.current++;
        setWires((W) => [...W, { id: "W" + wireCount.current, x1: a.x, y1: a.y, x2: b.x, y2: b.y }]);
        setSim(null);
        // chain: next wire starts where this one ended
        setTimeout(() => startCommand("Draw Wire", { 0: b }), 0);
        return;
      }
      case "Move Instance": {
        const inst = args[0], loc = args[1];
        setInstances((I) => I.map((i) => (i.id === inst.id ? { ...i, x: loc.x, y: loc.y } : i)));
        setSim(null);
        break;
      }
      case "Rotate Instance": {
        setInstances((I) => I.map((i) => (i.id === args[0].id ? { ...i, rot: ((i.rot || 0) + 90) % 360 } : i)));
        setSim(null);
        break;
      }
      case "Delete Instance": {
        setInstances((I) => I.filter((i) => i.id !== args[0].id));
        setSim(null);
        print([`Deleted `, { bold: true, text: instLabel(args[0]) }, `.`]);
        break;
      }
      case "Delete Wire": {
        setWires((W) => W.filter((w) => w.id !== args[0].id));
        setSim(null);
        break;
      }
      case "Edit Parameters": {
        const inst = args[0], v = String(args[1]).trim();
        if (!v) { print("No value given; parameters unchanged."); break; }
        setInstances((I) => I.map((i) => {
          if (i.id !== inst.id) return i;
          const params = { ...i.params };
          if (i.kind === "nmos" || i.kind === "pmos") params.wl = v;
          else if (i.kind === "cap" || i.kind === "res") params.val = v;
          else if (i.kind === "pad") params.name = v.toUpperCase();
          return { ...i, params };
        }));
        setSim(null);
        print([`Parameters of ${inst.id} set to `, { bold: true, text: v }, `.`]);
        break;
      }
      case "Describe Instance": {
        const inst = instances.find((i) => i.id === args[0].id) || args[0];
        print([{ bold: true, text: instLabel(inst) }, `  at (${inst.x},${inst.y}) rot ${inst.rot || 0}°`]);
        const parts = ["   Pins:  "];
        pinsOf(inst).forEach((p) => {
          const n = net.nodeAt(p.x, p.y);
          parts.push(`${p.name} → `, nodePres(n >= 0 ? net.nodes[n].name : "?"), "   ");
        });
        print(parts);
        if (inst.kind === "pad")
          print(`   ${SOURCES[inst.params.name] ? "Driven source (waveform " + inst.params.name + ")" : "Observer pad (high-Z)"}.`);
        break;
      }
      case "Probe Node": {
        const nd = args[0], pid = paneId(args[1]);
        setPanes((P) => P.map((p) => p.id === pid
          ? { ...p, probes: p.probes.includes(nd.name) ? p.probes : [...p.probes, nd.name].slice(-5) }
          : p));
        print([`Probe attached to node `, nodePres(nd.name), ` in pane ${pid}. Run `, { bold: true, text: ":Spice" }, ` to see it.`]);
        break;
      }
      case "Spice": {
        print(`Add nosfet diffusion strays?: Yes  No`);
        print(`SPICE Server: Local  pegasus  cupid  cream-of-wheat  rice-chex`);
        print(`Corners: ${CORNERS.map((c) => c.name).join("  ")}`);
        const t0 = Date.now();
        setTimeout(() => {
          const result = runSpice(buildNetlist(instances, wires));
          setSim(result);
          const ts = new Date().toTimeString().slice(0, 8);
          print(`[${ts} Your SPICE run is done.  (${result.devCount} devices, ${result.nodeCount} nodes, 5 corners, ${Date.now() - t0} ms)`);
          print(`          Results are plotted in the chart panes]`);
          const known = net.nodes.map((n) => n.name);
          print(["Nodes: ", ...known.flatMap((n) => [nodePres(n), "  "])]);
        }, 350);
        break;
      }
      case "Clear Pane": {
        const pid = paneId(args[0]);
        setPanes((P) => P.map((p) => (p.id === pid ? { ...p, probes: [] } : p)));
        break;
      }
      case "Clear Schematic":
        setInstances([]); setWires([]); setSim(null);
        print("Schematic erased. Right-click the canvas to start drawing.");
        break;
      case "Clear Listener": setLines([]); break;
      default: print(`Unimplemented command ${cmd}.`);
    }
  };

  /* -------- command loop -------- */
  const advance = (cmd, args) => {
    const spec = COMMANDS[cmd];
    const i = spec.args.findIndex((_, k) => args[k] === undefined);
    if (i === -1) { setAccept(null); execute(cmd, args); return; }
    const a = spec.args[i];
    setAccept({ cmd, args, argIndex: i, argType: a.type, argName: a.name || a.type, def: a.default });
    setTyped("");
    if (a.type === "component-type") {
      setTimeout(() => setMenu({
        x: window.innerWidth * 0.28, y: window.innerHeight * 0.3,
        title: "Choose a component type",
        items: KINDS.map((k) => ({ label: k.toUpperCase(), run: () => acceptObjectRef.current(k, "component-type") })),
      }), 0);
    }
    setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
  };

  const startCommand = (cmd, prefill = {}) => {
    const args = new Array(COMMANDS[cmd].args.length);
    Object.entries(prefill).forEach(([k, v]) => (args[Number(k)] = v));
    advance(cmd, args);
  };

  const acceptObject = (obj, type) => {
    setAccept((acc) => {
      if (!acc || acc.argType !== type) return acc;
      const args = acc.args.slice(); args[acc.argIndex] = obj;
      setTimeout(() => advance(acc.cmd, args), 0);
      return null;
    });
  };
  const acceptObjectRef = useRef(acceptObject); acceptObjectRef.current = acceptObject;

  const abort = useCallback(() => {
    setAccept((acc) => {
      if (acc) print([{ bold: true, text: ":" + acc.cmd + " " }, "…  [Abort]"]);
      return null;
    });
    setTyped("");
  }, [print]);

  const resolveToken = (type, tok) => {
    if (type === "instance") return findInst(tok) || null;
    if (type === "node") return findNode(tok) || null;
    if (type === "wire") return wires.find((w) => w.id.toUpperCase() === tok.toUpperCase()) || null;
    if (type === "pane") { const n = Number(tok); return n === 1 || n === 2 ? { id: n } : null; }
    if (type === "component-type") return KINDS.includes(tok.toLowerCase()) ? tok.toLowerCase() : null;
    if (type === "location") { const m = /(-?\d+)[ ,]+(-?\d+)/.exec(tok); return m ? { x: snap(+m[1]), y: snap(+m[2]) } : null; }
    if (type === "string") return tok;
    return null;
  };

  const submitTyped = () => {
    const text = typed.trim();
    if (accept) {
      const use = text === "" && accept.def !== undefined ? String(accept.def) : text;
      if (use === "") return;
      const v = resolveToken(accept.argType, use);
      if (v === null) { print(`"${use}" is not a valid ${accept.argType}.`); setTyped(""); return; }
      setTyped(""); acceptObject(v, accept.argType); return;
    }
    if (!text) return;
    setTyped("");
    const bare = text.replace(/^:/, "");
    const lower = bare.toLowerCase();
    const cmd = Object.keys(COMMANDS)
      .filter((c) => lower.startsWith(c.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0];
    if (!cmd) { print([`Unknown command: "${text}".  Right-click for the command menu.`]); return; }
    const rest = bare.slice(cmd.length).trim().split(/\s+/).filter(Boolean);
    const args = new Array(COMMANDS[cmd].args.length);
    for (let i = 0; i < args.length && rest.length; i++) {
      const v = resolveToken(COMMANDS[cmd].args[i].type, rest[0]);
      if (v !== null) { args[i] = v; rest.shift(); }
    }
    advance(cmd, args);
  };

  /* -------- default L-click per type -------- */
  const defaultAction = (type, obj) => {
    if (type === "instance") execute("Describe Instance", [obj]);
    else if (type === "node") execute("Probe Node", [obj, { id: 1 }]);
    else if (type === "command") startCommand(obj);
    else if (type === "wire") execute("Probe Node", [{ name: obj.nodeName }, { id: 1 }]);
  };

  /* -------- menus -------- */
  const openMenu = (x, y, target) => {
    let items = [];
    if (target.type === "instance") {
      const i = target.obj;
      items = [
        { label: "Describe", run: () => execute("Describe Instance", [i]) },
        { label: "Edit Parameters …", run: () => startCommand("Edit Parameters", { 0: i }) },
        { label: "Move …", run: () => startCommand("Move Instance", { 0: i }) },
        { label: "Rotate 90°", run: () => execute("Rotate Instance", [i]) },
        { label: "Delete", run: () => execute("Delete Instance", [i]) },
      ];
    } else if (target.type === "node") {
      const n = target.obj;
      items = [
        { label: "Probe in Pane 1", run: () => execute("Probe Node", [n, { id: 1 }]) },
        { label: "Probe in Pane 2", run: () => execute("Probe Node", [n, { id: 2 }]) },
      ];
    } else if (target.type === "wire") {
      const w = target.obj;
      items = [
        { label: `Probe node ${w.nodeName} in Pane 1`, run: () => execute("Probe Node", [{ name: w.nodeName }, { id: 1 }]) },
        { label: `Probe node ${w.nodeName} in Pane 2`, run: () => execute("Probe Node", [{ name: w.nodeName }, { id: 2 }]) },
        { label: "Delete Wire", run: () => execute("Delete Wire", [w]) },
      ];
    } else if (target.type === "pane") {
      const p = target.obj;
      items = [
        { label: "Probe a node here …", run: () => startCommand("Probe Node", { 1: { id: p.id } }) },
        { label: "Clear Pane", run: () => execute("Clear Pane", [{ id: p.id }]) },
        { label: "Run :Spice", run: () => execute("Spice", []) },
      ];
    } else if (target.type === "command") {
      items = [{ label: "Execute " + target.obj, run: () => startCommand(target.obj) }];
    }
    setMenu({ x, y, title: target.name, items });
  };

  const openCanvasMenu = (x, y, loc) => {
    setMenu({
      x, y, title: `CANVAS (${loc.x},${loc.y})`,
      items: [
        ...["nmos", "pmos", "cap", "res", "pad", "vdd", "gnd"].map((k) => ({
          label: `Draw ${k.toUpperCase()} here`, run: () => execute("Draw Instance", [k, loc]),
        })),
        { label: "Draw Wire from here …", run: () => startCommand("Draw Wire", { 0: loc }) },
        { label: "── Run :Spice", run: () => execute("Spice", []) },
        { label: "── Clear Schematic", run: () => execute("Clear Schematic", []) },
      ],
    });
  };

  useEffect(() => {
    const close = () => setMenu(null);
    const onKey = (e) => { if (e.key === "Escape") { setMenu(null); abort(); } };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", onKey); };
  }, [abort]);

  const ui = { accept, setDoc, acceptObject, openMenu, openCanvasMenu, defaultAction };

  /* placement ghost info for the canvas */
  let ghost = null;
  if (accept && accept.argType === "location") {
    if (accept.cmd === "Draw Instance" && accept.args[0])
      ghost = { kind: "instance", inst: { kind: accept.args[0], x: 0, y: 0, rot: 0, params: DEFAULT_PARAMS[accept.args[0]] } };
    else if (accept.cmd === "Draw Wire" && accept.argIndex === 1 && accept.args[0])
      ghost = { kind: "wire-from", from: accept.args[0] };
    else if (accept.cmd === "Move Instance" && accept.args[0])
      ghost = { kind: "instance", inst: { ...accept.args[0] } };
  }

  const docText = doc || (accept
    ? `Accepting ${accept.argType.toUpperCase()} for ${accept.cmd} — click a live presentation${accept.argType === "location" ? " on the canvas" : ""} or type below.  [Escape] aborts.`
    : "L: Select;  M: nothing special;  R: Menu.   Hover any presentation for its handlers.");

  const clockStr = clock.toLocaleString("en-US", {
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false,
  }).replace(",", "");

  const renderPart = (part, i) => {
    if (typeof part === "string") return <span key={i} style={{ whiteSpace: "pre-wrap" }}>{part}</span>;
    if (part.pres === "node") {
      const nd = findNode(part.name);
      return <Pres key={i} type="node" obj={nd || { name: part.name }}>{part.name}</Pres>;
    }
    if (part.bold) return <span key={i} style={{ fontWeight: 700, whiteSpace: "pre-wrap" }}>{part.text}</span>;
    return <span key={i}>{String(part.text ?? part)}</span>;
  };

  const promptText = accept
    ? `${accept.cmd} (${accept.argName}${accept.def !== undefined ? ` [default ${accept.def}]` : ""}): `
    : "Command: ";

  return (
    <UICtx.Provider value={ui}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap');
        @keyframes dwblink { 0%,49%{opacity:1;} 50%,100%{opacity:0;} }
        *{box-sizing:border-box;} ::selection{background:${INK};color:${PAPER};}
      `}</style>

      <div
        style={{
          fontFamily: FONT, background: INK, color: INK, height: "100vh",
          display: "flex", flexDirection: "column", padding: 3, gap: 3, fontSize: 13, userSelect: "none",
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* title bar */}
        <div style={{ background: PAPER, border: `1px solid ${INK}` }}>
          <div style={{ background: INK, color: PAPER, padding: "2px 8px", fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
            <span>▞ TEST-CARRY-CELL-1 (Schematic)</span><span>1.4</span>
          </div>
        </div>

        {/* main: schematic | waveform panes */}
        <div style={{ flex: 5, minHeight: 0, display: "flex", gap: 3 }}>
          <div style={{ flex: 11, minWidth: 0, background: PAPER, border: `1px solid ${INK}`, display: "flex", flexDirection: "column" }}>
            <div style={{ background: INK, color: PAPER, padding: "1px 8px", fontWeight: 700, fontSize: 12, display: "flex", justifyContent: "space-between" }}>
              <span>SCHEMATIC — virtual grid {G}</span>
              <span>{instances.length} instances · {wires.length} wires · {net.nodes.length} nodes{sim ? "" : "  (unsimulated)"}</span>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <Canvas instances={instances} wires={wires} net={net} accept={accept} toPlaceGhost={ghost} />
            </div>
          </div>
          <div style={{ flex: 9, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            {panes.map((p) => (
              <div key={p.id} style={{ flex: 1, minHeight: 0, background: PAPER, border: `1px solid ${INK}`, display: "flex" }}>
                <WavePane pane={p} sim={sim} />
              </div>
            ))}
          </div>
        </div>

        {/* black mode strip */}
        <div style={{ background: INK, color: PAPER, display: "flex", fontWeight: 700, fontSize: 13 }}>
          {[
            ["Select", () => { abort(); }],
            ["Wire", () => startCommand("Draw Wire")],
            ["Redisplay", () => setSim((s) => (s ? { ...s } : s))],
          ].map(([label, run], i) => (
            <div key={label}
              style={{ flex: 1, textAlign: "center", padding: "1px 0", cursor: "pointer", borderLeft: i ? `1px solid ${PAPER}` : "none" }}
              onClick={(e) => { e.stopPropagation(); run(); }}
              onMouseEnter={() => setDoc(`L: ${label === "Select" ? "return to select mode (abort current command)" : label === "Wire" ? "start drawing wires" : "redisplay the panes"}.`)}
              onMouseLeave={() => setDoc(null)}
            >{label}</div>
          ))}
        </div>

        {/* command menu */}
        <div style={{ background: PAPER, border: `1px solid ${INK}`, padding: "5px 10px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", rowGap: 3, columnGap: 8, textAlign: "center" }}>
            {Object.keys(COMMANDS).map((c) => (
              <Pres key={c} type="command" obj={c} label={c}>
                <span style={{ fontWeight: 700, fontSize: 13, padding: "0 4px" }}
                  onMouseEnter={() => setDoc(`${c}: ${COMMANDS[c].doc}  L: execute.`)}>
                  {c}
                </span>
              </Pres>
            ))}
          </div>
        </div>

        {/* listener */}
        <div style={{ flex: 3, minHeight: 110, background: PAPER, border: `1px solid ${INK}`, display: "flex", flexDirection: "column" }}
          onClick={() => inputRef.current && inputRef.current.focus()}>
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "3px 8px", lineHeight: 1.5 }}>
            {lines.map((l, i) => <div key={i} style={{ whiteSpace: "pre-wrap" }}>{l.parts.map(renderPart)}</div>)}
            <div style={{ whiteSpace: "pre-wrap" }}>
              <span style={{ fontWeight: 700 }}>{promptText}</span>
              <span>{typed}</span>
              <span style={{ animation: "dwblink 1s step-end infinite" }}>█</span>
              <input ref={inputRef} value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitTyped(); }}
                style={{ position: "absolute", opacity: 0, width: 1, height: 1, pointerEvents: "none" }}
                autoFocus />
            </div>
          </div>
        </div>

        {/* mouse documentation + status */}
        <div style={{ background: INK, color: PAPER, padding: "2px 8px", fontSize: 12, minHeight: 20, fontWeight: 500 }}>
          {docText}
        </div>
        <div style={{ background: PAPER, border: `1px solid ${INK}`, padding: "1px 8px", fontSize: 12, display: "flex", justifyContent: "space-between" }}>
          <span>[{clockStr}]&nbsp;&nbsp;Keyboard</span>
          <span>CL MS:&nbsp;&nbsp;<u>Tyi</u></span>
          <span>{accept ? `Accepting ${accept.argType}` : sim ? "SPICE results loaded" : "Unsimulated"}</span>
          <span>Lisp Machine Pigpen</span>
        </div>

        {/* pop-up menu */}
        {menu && (
          <div
            style={{
              position: "fixed",
              left: Math.max(4, Math.min(menu.x, window.innerWidth - 260)),
              top: Math.max(4, Math.min(menu.y, window.innerHeight - 60 - menu.items.length * 24)),
              background: PAPER, color: INK, border: `2px solid ${INK}`,
              boxShadow: `5px 5px 0 0 ${INK}`, minWidth: 230, zIndex: 100, fontSize: 13,
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <div style={{ background: INK, color: PAPER, fontWeight: 700, padding: "2px 8px" }}>{menu.title}</div>
            {menu.items.map((it, i) => (
              <div key={i}
                style={{ padding: "2px 10px", cursor: "pointer" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = INK; e.currentTarget.style.color = PAPER; setDoc(`L: ${it.label}`); }}
                onMouseLeave={(e) => { e.currentTarget.style.background = PAPER; e.currentTarget.style.color = INK; }}
                onClick={() => { setMenu(null); it.run(); }}>
                {it.label}
              </div>
            ))}
            <div style={{ padding: "2px 10px", opacity: 0.6, borderTop: `1px solid ${INK}`, cursor: "pointer" }}
              onClick={() => { setMenu(null); abort(); }}>
              Abort
            </div>
          </div>
        )}
      </div>
    </UICtx.Provider>
  );
}

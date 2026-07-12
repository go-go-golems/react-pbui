import React, { useState, useEffect, useRef, useCallback } from "react";

/* ============================================================================
   PRESENTA — Metrics II
   A CLIM / Genera Dynamic-Windows style presentation-based UI in React,
   now with a proper 3D wireframe rendering engine.

   CLIM ideas implemented:
   - Every object on screen is a *presentation* of a typed object — including
     the joints of the 3D wireframe arms in the viewport.
   - Mouse-R on a presentation pops a menu of commands applicable to its type.
   - Commands have typed arguments; missing arguments are *accepted* by
     pointing at matching presentations or typing at the Listener.

   Wireframe engine:
   - Row-major mat4 math, hierarchical matrix-stack scene graph,
     look-at orbit camera, perspective projection, near-plane line clipping,
     depth-cued stroke widths, canvas rasterization at devicePixelRatio.
   - Each metric drives a joint of a 3-DOF-per-arm × 6-joint robot arm;
     one arm per node. Joint markers are hit-tested screen-space, so the
     3D scene participates fully in the presentation system.
   ============================================================================ */

/* ----------------------------- simulated world ---------------------------- */

const METRIC_ROWS = ["CPU-LOAD", "MEM-USED", "NET-IN", "NET-OUT", "DISK-IO", "TEMP"];
const NODES = ["NODE-A", "NODE-B", "NODE-C"];
const HISTORY = 90;

function makeGauges() {
  const g = [];
  METRIC_ROWS.forEach((name, r) =>
    NODES.forEach((node, c) => {
      const base = 20 + ((r * 31 + c * 17) % 55);
      g.push({
        id: `${name}@${node}`,
        name, node, row: r, col: c,
        value: base,
        peak: base,
        alarm: 85,
        history: Array.from({ length: HISTORY }, () => base),
        plotted: false,
      });
    })
  );
  return g;
}

function stepGauge(g, paused) {
  if (paused) return g;
  const drift = (Math.random() - 0.5) * 9;
  const pull = (45 + g.row * 7 - g.value) * 0.03;
  const spike = Math.random() < 0.012 ? Math.random() * 35 : 0;
  let v = Math.max(0, Math.min(100, g.value + drift + pull + spike));
  const history = g.history.slice(1).concat(v);
  return { ...g, value: v, peak: Math.max(g.peak, v), history };
}

/* ============================ 3D WIREFRAME ENGINE ========================== */
/* Row-major 4x4 matrices; point transform p' = M·p.                          */

const M_I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mmul(a, b) {
  const r = new Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j];
      r[i * 4 + j] = s;
    }
  return r;
}
const mT = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const mRX = (t) => { const c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]; };
const mRY = (t) => { const c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]; };
const mRZ = (t) => { const c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; };
const xf = (m, p) => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
  m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
  m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
];

function lookAt(eye, tgt) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = nrm(sub(eye, tgt));
  const x = nrm(crs([0, 1, 0], z));
  const y = crs(z, x);
  return [x[0], x[1], x[2], -dot(x, eye), y[0], y[1], y[2], -dot(y, eye), z[0], z[1], z[2], -dot(z, eye), 0, 0, 0, 1];
}

/* ------- meshes: {v:[[x,y,z]...], e:[[i,j]...]} ------- */

function boxSpan(w, len, d) { // spans y: 0..len, centered in x/z
  const x = w / 2, z = d / 2;
  const v = [
    [-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z],
    [-x, len, -z], [x, len, -z], [x, len, z], [-x, len, z],
  ];
  const e = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  return { v, e };
}
const boxC = (w, h, d) => {
  const m = boxSpan(w, h, d);
  return { v: m.v.map(([x, y, z]) => [x, y - h / 2, z]), e: m.e };
};
function cyl(r, h, seg = 8) {
  const v = [], e = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    v.push([r * Math.cos(a), 0, r * Math.sin(a)]);
    v.push([r * Math.cos(a), h, r * Math.sin(a)]);
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    e.push([i * 2, j * 2], [i * 2 + 1, j * 2 + 1]);
    if (i % 2 === 0) e.push([i * 2, i * 2 + 1]);
  }
  return { v, e };
}
function gridMesh(n, s) {
  const v = [], e = [], ext = n * s;
  for (let i = -n; i <= n; i++) {
    v.push([i * s, 0, -ext], [i * s, 0, ext]); e.push([v.length - 2, v.length - 1]);
    v.push([-ext, 0, i * s], [ext, 0, i * s]); e.push([v.length - 2, v.length - 1]);
  }
  return { v, e };
}
function merge(...ms) {
  const v = [], e = [];
  for (const m of ms) {
    const o = v.length;
    v.push(...m.v);
    e.push(...m.e.map(([a, b]) => [a + o, b + o]));
  }
  return { v, e };
}
const shift = (m, x, y, z) => ({ v: m.v.map(([a, b, c]) => [a + x, b + y, c + z]), e: m.e });

/* precomputed meshes */
const MESH = {
  grid: gridMesh(4, 1.4),
  enclosure: shift(boxC(12.4, 6.6, 9.2), 0, 3.3, 0),
  plinth: boxSpan(1.5, 0.55, 1.5),
  turret: cyl(0.55, 0.7, 8),
  upper: boxSpan(0.44, 1.7, 0.44),
  fore: boxSpan(0.34, 1.45, 0.34),
  wrist: cyl(0.26, 0.42, 6),
  hand: merge(
    boxSpan(0.5, 0.16, 0.4),                       // palm
    shift(boxSpan(0.09, 0.5, 0.09), -0.17, 0.16, 0), // finger L
    shift(boxSpan(0.09, 0.5, 0.09), 0.17, 0.16, 0)   // finger R
  ),
  satellite: boxC(0.9, 0.9, 0.9),
};

/* value 0..100 -> joint angle */
const JOINT_MAP = [
  (v) => ((v - 50) / 50) * Math.PI * 0.85,   // CPU-LOAD  -> base yaw
  (v) => -0.15 - (v / 100) * 1.15,           // MEM-USED  -> shoulder pitch
  (v) => 0.25 + (v / 100) * 1.5,             // NET-IN    -> elbow pitch
  (v) => ((v - 50) / 50) * Math.PI,          // NET-OUT   -> wrist roll
  (v) => ((v - 50) / 50) * 1.15,             // DISK-IO   -> wrist bend
  (v) => ((v - 50) / 50) * Math.PI,          // TEMP      -> end-effector roll
];

/* ---------------------------- scene renderer ------------------------------ */

function renderScene(ctx, W, H, cam, angles, gauges, ui) {
  const NEAR = 0.25;
  const eye = [
    cam.target[0] + cam.dist * Math.cos(cam.phi) * Math.sin(cam.theta),
    cam.target[1] + cam.dist * Math.sin(cam.phi),
    cam.target[2] + cam.dist * Math.cos(cam.phi) * Math.cos(cam.theta),
  ];
  const view = lookAt(eye, cam.target);
  const focal = (H / 2) / Math.tan((55 * Math.PI) / 360);
  const cx = W / 2, cy = H / 2;

  const hits = []; // {x, y, gaugeId}

  const proj = (pc) => [cx + (focal * pc[0]) / -pc[2], cy - (focal * pc[1]) / -pc[2], -pc[2]];

  function edge(pa, pb) {
    let a = pa, b = pb;
    const za = -a[2], zb = -b[2];
    if (za < NEAR && zb < NEAR) return;
    if (za < NEAR || zb < NEAR) {
      const t = (NEAR - za) / (zb - za);
      const c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, -NEAR];
      if (za < NEAR) a = c; else b = c;
    }
    const A = proj(a), B = proj(b);
    const depth = (A[2] + B[2]) / 2;
    ctx.lineWidth = Math.max(0.6, Math.min(2.1, 2.3 - depth * 0.085));
    ctx.beginPath();
    ctx.moveTo(A[0], A[1]);
    ctx.lineTo(B[0], B[1]);
    ctx.stroke();
  }

  /* matrix stack */
  const stack = [M_I];
  const top = () => stack[stack.length - 1];
  const push = (m) => stack.push(mmul(top(), m));
  const pop = () => stack.pop();
  const mesh = (m) => {
    const t = top();
    const pcs = m.v.map((p) => xf(view, xf(t, p)));
    for (const [i, j] of m.e) edge(pcs[i], pcs[j]);
  };
  const marker = (gaugeId) => {
    const w = xf(top(), [0, 0, 0]);
    const pc = xf(view, w);
    if (-pc[2] < NEAR) return;
    const P = proj(pc);
    hits.push({ x: P[0], y: P[1], gaugeId });
  };
  const label = (text, p, dy = 0) => {
    const pc = xf(view, p);
    if (-pc[2] < NEAR) return;
    const P = proj(pc);
    ctx.fillText(text, P[0], P[1] + dy);
  };

  /* ---- draw ---- */
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#000";
  ctx.font = `700 11px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textAlign = "center";

  mesh(MESH.grid);
  mesh(MESH.enclosure);

  /* floating satellite cube, slowly tumbling */
  push(mmul(mT(0, 5.1, -2.6), mmul(mRY(ui.t * 0.4), mRX(ui.t * 0.23))));
  mesh(MESH.satellite);
  pop();

  const armX = [-3.4, 0, 3.4];
  NODES.forEach((node, c) => {
    const a = angles[c]; // [base, shoulder, elbow, wristRot, wristBend, eeRot]
    const gid = (r) => `${METRIC_ROWS[r]}@${node}`;

    push(mT(armX[c], 0, 0));
    mesh(MESH.plinth);
    label(node, [armX[c], -0.28, 1.4]);

    push(mmul(mT(0, 0.55, 0), mRY(a[0])));            // BASE yaw
    mesh(MESH.turret);
    marker(gid(0));

    push(mmul(mT(0, 0.7, 0), mRZ(a[1])));             // SHOULDER pitch
    mesh(MESH.upper);
    marker(gid(1));

    push(mmul(mT(0, 1.7, 0), mRZ(a[2])));             // ELBOW pitch
    mesh(MESH.fore);
    marker(gid(2));

    push(mmul(mT(0, 1.45, 0), mRY(a[3])));            // WRIST roll
    mesh(MESH.wrist);
    marker(gid(3));

    push(mmul(mT(0, 0.42, 0), mRX(a[4])));            // WRIST bend
    marker(gid(4));

    push(mRY(a[5]));                                  // EE roll
    mesh(MESH.hand);
    marker(gid(5));

    pop(); pop(); pop(); pop(); pop(); pop(); pop();
  });

  /* ---- markers / presentation feedback (screen-space overlay) ---- */
  const blink = (Date.now() >> 8) & 1;
  ctx.textAlign = "left";
  for (const h of hits) {
    const g = gauges.find((x) => x.id === h.gaugeId);
    const alarmed = g && g.value > g.alarm;
    ctx.lineWidth = 1.4;
    if (alarmed && blink) {
      ctx.fillRect(h.x - 5, h.y - 5, 10, 10);
    } else {
      ctx.fillRect(h.x - 2, h.y - 2, 4, 4);
    }
    if (ui.acceptingGauge) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = blink ? 3 : 0;
      ctx.strokeRect(h.x - 9, h.y - 9, 18, 18);
      ctx.restore();
    }
    if (ui.hoverGaugeId === h.gaugeId) {
      ctx.strokeRect(h.x - 11, h.y - 11, 22, 22);
      const s = `${h.gaugeId} ${g ? g.value.toFixed(0) : ""}`;
      const w = ctx.measureText(s).width;
      ctx.fillRect(h.x + 13, h.y - 18, w + 8, 15);
      ctx.save();
      ctx.fillStyle = "#fff";
      ctx.fillText(s, h.x + 17, h.y - 7);
      ctx.restore();
    }
  }
  return hits;
}

/* ------------------------------- command table ---------------------------- */

const COMMANDS = [
  { name: "Describe Object", args: [{ name: "object", type: "any", input: "presentation" }],
    doc: "Print a description of any presented object." },
  { name: "Inspect", args: [{ name: "object", type: "any", input: "presentation" }],
    doc: "Show the slots of any presented object." },
  { name: "Plot Metric", args: [{ name: "gauge", type: "gauge", input: "presentation" }],
    doc: "Add a metric's history to the strip-chart view." },
  { name: "Remove From Plot", args: [{ name: "gauge", type: "gauge", input: "presentation" }],
    doc: "Remove a metric from the strip-chart view." },
  { name: "Set Metric Value",
    args: [{ name: "gauge", type: "gauge", input: "presentation" },
           { name: "value", type: "number", input: "number", prompt: "Value [0..100]" }],
    doc: "Force a metric to a value (keyboard input at the Listener)." },
  { name: "Set Alarm Level",
    args: [{ name: "gauge", type: "gauge", input: "presentation" },
           { name: "level", type: "number", input: "number", prompt: "Alarm level [0..100]" }],
    doc: "Set the alarm threshold for a metric." },
  { name: "Reset Peak", args: [{ name: "gauge", type: "gauge", input: "presentation" }],
    doc: "Reset a metric's recorded peak value." },
  { name: "Assign Port",
    args: [{ name: "port", type: "port", input: "presentation" },
           { name: "gauge", type: "gauge", input: "presentation" }],
    doc: "Wire a metric into a readout port — both arguments by pointing." },
  { name: "Free Port", args: [{ name: "port", type: "port", input: "presentation" }],
    doc: "Disconnect a readout port." },
  { name: "Hardcopy Window", args: [{ name: "window", type: "window", input: "presentation" }],
    doc: "Send a pane to the (imaginary) LGP-2 laser printer." },
  { name: "Show Wireframe View", args: [], global: true, doc: "Show the 3D wireframe scene in the viewport." },
  { name: "Show Plot View", args: [], global: true, doc: "Show strip charts of plotted metrics in the viewport." },
  { name: "Reset Camera", args: [], global: true, doc: "Return the wireframe camera to its home position." },
  { name: "Pause Telemetry", args: [], global: true, doc: "Freeze the simulated telemetry stream." },
  { name: "Resume Telemetry", args: [], global: true, doc: "Resume the simulated telemetry stream." },
  { name: "Clear Output History", args: [], global: true, doc: "Clear the Listener." },
  { name: "Show Commands", args: [], global: true, doc: "List the command table." },
];

const cmdByName = Object.fromEntries(COMMANDS.map((c) => [c.name, c]));
const commandsFor = (ptype) =>
  COMMANDS.filter((c) => c.args.length > 0 && (c.args[0].type === ptype || c.args[0].type === "any"));

/* --------------------------------- helpers -------------------------------- */

function wedgePath(cx, cy, r, frac) {
  if (frac <= 0.002) return "";
  if (frac >= 0.998) frac = 0.998;
  const a0 = -Math.PI / 2;
  const a1 = a0 + frac * 2 * Math.PI;
  const large = frac > 0.5 ? 1 : 0;
  return `M ${cx} ${cy} L ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} Z`;
}

function describe(p) {
  const o = p.obj;
  switch (p.ptype) {
    case "gauge":
      return [
        `#<GAUGE ${o.id}>`,
        `  A telemetry channel of class METRIC-GAUGE.`,
        `  Current value ${o.value.toFixed(1)}, peak ${o.peak.toFixed(1)}, alarm at ${o.alarm}.`,
        `  Drives the ${o.name} joint of wireframe arm ${o.node}.`,
        `  ${o.plotted ? "Currently plotted." : "Not plotted."}`,
      ];
    case "port":
      return [`#<PORT ${o.index}>`,
        o.gaugeId ? `  Readout port wired to ${o.gaugeId}.` : `  Readout port, unconnected.  "No Port".`];
    case "window":
      return [`#<DYNAMIC-WINDOW ${o.name}>`, `  A pane of the frame PRESENTA-METRICS-II.`];
    default:
      return [`#<OBJECT ${JSON.stringify(o)}>`];
  }
}

function inspect(p) {
  const o = p.obj;
  const rows = Object.entries(o)
    .filter(([, v]) => typeof v !== "object" || v === null)
    .map(([k, v]) => `    ${k.toUpperCase().padEnd(10)} ${typeof v === "number" ? +v.toFixed(2) : v}`);
  return [`Inspecting #<${p.ptype.toUpperCase()} ${o.id || o.name || (o.index ?? "")}>`, ...rows];
}

/* ================================== APP ==================================== */

export default function App() {
  const [gauges, setGauges] = useState(makeGauges);
  const [ports, setPorts] = useState(() =>
    Array.from({ length: 8 }, (_, i) => ({ id: `PORT-${i}`, index: i, gaugeId: null }))
  );
  const [paused, setPaused] = useState(false);
  const [viewMode, setViewMode] = useState("wire");
  const [lines, setLines] = useState([
    { t: "out", s: "Genera-style presentation frame loaded." },
    { t: "out", s: "Loading... MetricsII:Worlds;DEMO-4-ARMS  (wireframe engine online)" },
    { t: "out", s: "Mouse-R on any object for its command menu — including 3D joints." },
  ]);
  const [events, setEvents] = useState([{ s: "18 channels attached from COM-LOAD" }]);
  const [menu, setMenu] = useState(null);
  const [accept, setAccept] = useState(null);
  const [mouseDoc, setMouseDoc] = useState("Mouse-R: Main Menu.");
  const [hoverId, setHoverId] = useState(null);
  const [clock, setClock] = useState(new Date());
  const inputRef = useRef(null);
  const listenerRef = useRef(null);
  const cameraRef = useRef({ theta: 0.55, phi: 0.34, dist: 12.5, target: [0, 1.9, 0] });

  /* ------------------------------ simulation ------------------------------ */
  useEffect(() => {
    const id = setInterval(() => {
      setGauges((gs) => {
        const next = gs.map((g) => stepGauge(g, paused));
        next.forEach((g, i) => {
          const prev = gs[i];
          if (prev.value <= prev.alarm && g.value > g.alarm) {
            setEvents((e) =>
              [{ s: `ALARM ${g.id} crossed ${g.alarm} (${g.value.toFixed(1)})` }, ...e].slice(0, 40));
          }
        });
        return next;
      });
    }, 650);
    return () => clearInterval(id);
  }, [paused]);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { listenerRef.current?.scrollTo(0, 1e9); }, [lines, accept]);

  const say = useCallback((...ss) => {
    setLines((l) => [...l, ...ss.map((s) => (typeof s === "string" ? { t: "out", s } : s))]);
  }, []);

  /* ------------------------------ command exec ---------------------------- */
  const execute = useCallback((cmd, args) => {
    const label = (a) =>
      a == null ? "NIL" : a.ptype ? a.obj.id || a.obj.name || `PORT-${a.obj.index}` : String(a);
    setLines((l) => [...l, { t: "echo", s: `Command: ${cmd.name} ${args.map(label).join(" ")}` }]);
    const g = (a) => a && a.ptype === "gauge" && a.obj.id;

    switch (cmd.name) {
      case "Describe Object": say(...describe(args[0])); break;
      case "Inspect": say(...inspect(args[0])); break;
      case "Plot Metric": {
        const id = g(args[0]);
        setGauges((gs) => gs.map((x) => (x.id === id ? { ...x, plotted: true } : x)));
        setViewMode("plot");
        say(`${id} added to plot.  (Viewport switched to Plot view.)`);
        break;
      }
      case "Remove From Plot": {
        const id = g(args[0]);
        setGauges((gs) => gs.map((x) => (x.id === id ? { ...x, plotted: false } : x)));
        say(`${id} removed from plot.`);
        break;
      }
      case "Set Metric Value": {
        const id = g(args[0]);
        const v = Math.max(0, Math.min(100, args[1]));
        setGauges((gs) => gs.map((x) =>
          x.id === id ? { ...x, value: v, peak: Math.max(x.peak, v), history: x.history.slice(1).concat(v) } : x));
        say(`${id} forced to ${v}.  Watch the joint move.`);
        break;
      }
      case "Set Alarm Level": {
        const id = g(args[0]);
        const v = Math.max(0, Math.min(100, args[1]));
        setGauges((gs) => gs.map((x) => (x.id === id ? { ...x, alarm: v } : x)));
        say(`${id} alarm level set to ${v}.`);
        break;
      }
      case "Reset Peak": {
        const id = g(args[0]);
        setGauges((gs) => gs.map((x) => (x.id === id ? { ...x, peak: x.value } : x)));
        say(`${id} peak reset.`);
        break;
      }
      case "Assign Port": {
        const port = args[0].obj, id = g(args[1]);
        setPorts((ps) => ps.map((p) => (p.index === port.index ? { ...p, gaugeId: id } : p)));
        say(`PORT-${port.index} wired to ${id}.`);
        break;
      }
      case "Free Port": {
        const port = args[0].obj;
        setPorts((ps) => ps.map((p) => (p.index === port.index ? { ...p, gaugeId: null } : p)));
        say(`PORT-${port.index} disconnected.  No Port.`);
        break;
      }
      case "Hardcopy Window":
        say(`Hardcopy of ${args[0].obj.name} queued to LGP-2 on SATURN.`,
            `1 request in queue; estimated 40 seconds.`);
        break;
      case "Show Wireframe View": setViewMode("wire"); say("Viewport: wireframe scene."); break;
      case "Show Plot View": setViewMode("plot"); say("Viewport: strip charts."); break;
      case "Reset Camera":
        cameraRef.current = { theta: 0.55, phi: 0.34, dist: 12.5, target: [0, 1.9, 0] };
        say("Camera returned to home position.");
        break;
      case "Pause Telemetry": setPaused(true); say("Telemetry stream paused."); break;
      case "Resume Telemetry": setPaused(false); say("Telemetry stream resumed."); break;
      case "Clear Output History": setLines([]); break;
      case "Show Commands":
        say("Command table PRESENTA-METRICS-II:",
          ...COMMANDS.map((c) => `  ${c.name.padEnd(22)} (${c.args.map((a) => a.type).join(", ") || "—"})`));
        break;
      default: say({ t: "err", s: `No handler for ${cmd.name}` });
    }
  }, [say]);

  /* --------------------- argument acceptance state machine ---------------- */
  const advance = useCallback((cmd, args) => {
    if (args.length >= cmd.args.length) {
      setAccept(null);
      execute(cmd, args);
      return;
    }
    const spec = cmd.args[args.length];
    setAccept({ cmd, args, spec, typed: "" });
    if (spec.input !== "presentation") setTimeout(() => inputRef.current?.focus(), 0);
  }, [execute]);

  const startCommand = useCallback((cmd, firstPres) => {
    setMenu(null);
    const args = [];
    if (firstPres && cmd.args.length > 0) {
      const s = cmd.args[0];
      if (s.type === "any" || s.type === firstPres.ptype) args.push(firstPres);
    }
    advance(cmd, args);
  }, [advance]);

  const abort = useCallback(() => {
    if (accept) { setAccept(null); say({ t: "err", s: "Command aborted." }); }
    setMenu(null);
  }, [accept, say]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && abort();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abort]);

  /* --------------------------- presentation plumbing ----------------------- */
  const wanted = accept?.spec?.input === "presentation" ? accept.spec.type : null;
  const matches = useCallback(
    (ptype) => wanted != null && (wanted === "any" || wanted === ptype), [wanted]);

  const openMenuFor = useCallback((pres, x, y) => {
    const cmds = commandsFor(pres.ptype);
    setMenu({
      x: Math.max(0, Math.min(x, window.innerWidth - 250)),
      y: Math.max(0, Math.min(y, window.innerHeight - 26 * (cmds.length + 2))),
      title: pres.obj.id || pres.obj.name || `PORT-${pres.obj.index}`,
      items: cmds.map((c) => ({ label: c.name, cmd: c, pres })),
    });
  }, []);

  function acceptDoc(a) {
    return a.spec.input === "presentation"
      ? `Accepting an object of type ${a.spec.type.toUpperCase()} — point at a highlighted presentation. Escape: Abort.`
      : `Type ${a.spec.name} at the Listener, then Return. Escape: Abort.`;
  }

  const presProps = useCallback((pres, quiet) => ({
    onMouseEnter: () => {
      setHoverId(pres.key);
      const nm = pres.obj.id || pres.obj.name || `PORT-${pres.obj.index}`;
      if (matches(pres.ptype))
        setMouseDoc(`Mouse-L: ${nm} as ${accept.spec.name.toUpperCase()} argument; Mouse-R: Abort.`);
      else if (!quiet)
        setMouseDoc(`Mouse-L: Select ${nm}; Mouse-R: Menu of ${pres.ptype.toUpperCase()} commands.`);
    },
    onMouseLeave: () => {
      setHoverId((h) => (h === pres.key ? null : h));
      setMouseDoc(accept ? acceptDoc(accept) : "Mouse-R: Main Menu.");
    },
    onClick: (e) => {
      if (matches(pres.ptype)) { e.stopPropagation(); advance(accept.cmd, [...accept.args, pres]); }
    },
    onContextMenu: (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (accept) return abort();
      openMenuFor(pres, e.clientX, e.clientY);
    },
    className:
      "pres" + (quiet ? " quiet" : "") +
      (hoverId === pres.key ? " pres-hover" : "") +
      (matches(pres.ptype) ? " pres-accepting" : ""),
  }), [accept, hoverId, matches, advance, abort, openMenuFor]);

  /* ------------------------------- listener input -------------------------- */
  const submitTyped = () => {
    if (!accept || accept.spec.input === "presentation") return;
    const raw = accept.typed.trim();
    if (accept.spec.input === "number") {
      const n = parseFloat(raw);
      if (isNaN(n)) {
        say({ t: "err", s: `"${raw}" is not a valid NUMBER for ${accept.spec.name}.` });
        setAccept({ ...accept, typed: "" });
        return;
      }
      advance(accept.cmd, [...accept.args, n]);
    } else {
      advance(accept.cmd, [...accept.args, raw]);
    }
  };

  const openGlobalMenu = (e, title, names) => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({
      x: r.left, y: r.bottom + 2, title,
      items: names.map((n) => ({ label: n, cmd: cmdByName[n], pres: null })),
    });
  };

  const plotted = gauges.filter((g) => g.plotted);

  /* =============================== rendering =============================== */
  return (
    <div
      className="frame"
      onClick={() => setMenu(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        if (accept) return abort();
        setMenu({
          x: Math.max(0, Math.min(e.clientX, window.innerWidth - 250)),
          y: Math.max(0, Math.min(e.clientY, window.innerHeight - 360)),
          title: "Main Menu",
          items: COMMANDS.filter((c) => c.global).map((c) => ({ label: c.name, cmd: c, pres: null })),
        });
      }}
    >
      <style>{CSS}</style>

      {/* ------------------------------ menubar ------------------------------ */}
      <div className="menubar">
        {[
          ["FILE", ["Hardcopy Window", "Clear Output History"]],
          ["VIEW", ["Show Wireframe View", "Show Plot View", "Reset Camera"]],
          ["TELEM", ["Pause Telemetry", "Resume Telemetry"]],
          ["PLOT", ["Plot Metric", "Remove From Plot"]],
          ["HELP", ["Show Commands"]],
        ].map(([t, names]) => (
          <button key={t} className="menubtn"
            onClick={(e) => { e.stopPropagation(); openGlobalMenu(e, t, names); }}>
            {t.split("").join(" ")}
          </button>
        ))}
        <div className="titlebox">PRESENTA — Metrics II</div>
      </div>

      <div className="mid">
        {viewMode === "wire" ? (
          <WireViewport
            gauges={gauges}
            cameraRef={cameraRef}
            presProps={presProps}
            io={{ accept, matches, advance, abort, openMenuFor, setMouseDoc }}
          />
        ) : (
          <PlotViewport plotted={plotted} paused={paused} presProps={presProps} />
        )}

        {/* ----------------------------- gauge grid --------------------------- */}
        <div className="gaugepane">
          {METRIC_ROWS.map((name, r) => (
            <React.Fragment key={name}>
              <div className="gaugerow-label" style={{ gridRow: r * 2 + 1 }}>
                {NODES.map((node) => (<div key={node} className="gl-cell">{name}</div>))}
              </div>
              <div className="gaugerow" style={{ gridRow: r * 2 + 2 }}>
                {gauges.filter((g) => g.row === r).map((g) => (
                  <Gauge key={g.id} g={g} presProps={presProps} />
                ))}
              </div>
            </React.Fragment>
          ))}
          <div className="gaugefooter">
            {NODES.map((n) => (<div key={n} className="gf-cell"><i>{n}</i></div>))}
          </div>
        </div>
      </div>

      <div className="lower">
        {/* ------------------------------- ports ------------------------------ */}
        <div className="portgrid">
          {ports.map((p) => {
            const g = gauges.find((x) => x.id === p.gaugeId);
            const pres = { key: `port-${p.index}`, ptype: "port", obj: p };
            return (
              <div key={p.id} {...presProps(pres)}>
                <div className="port">
                  <div className="port-head"><span>N</span><span>O</span><span>N</span><span>E</span></div>
                  <div className="port-body">
                    <div className="port-icon">⟳</div>
                    {g ? (
                      <div className="port-live">
                        <div className="port-name">{g.name}</div>
                        <div className="port-sub">{g.node}</div>
                        <div className="port-val">{g.value.toFixed(0)}</div>
                      </div>
                    ) : (
                      <div className="port-none">N o&nbsp;&nbsp;P o r t</div>
                    )}
                    <div className="port-icon">⟳</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ---------------------------- event log ----------------------------- */}
        <div className="eventlog">
          <div className="el-scroll">
            {events.map((e, i) => (
              <div key={i} className="el-line"><span className="el-mark" /> {e.s}</div>
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------- listener ----------------------------- */}
      {(() => {
        const pres = { key: "win-listener", ptype: "window", obj: { name: "LISTENER" } };
        const p = presProps(pres);
        const orig = p.onClick;
        return (
          <div {...p} onClick={(e) => { orig(e); inputRef.current?.focus(); }}
               className={"listener-inner " + p.className}>
            <div className="lst-scroll" ref={listenerRef}>
              {lines.map((l, i) => (<div key={i} className={"lst-line lst-" + l.t}>{l.s}</div>))}
              <div className="lst-prompt">
                {accept && accept.spec.input !== "presentation" ? (
                  <>
                    <span className="lst-accept">
                      {accept.cmd.name} — {accept.spec.prompt || accept.spec.name}:&nbsp;
                    </span>
                    <span>{accept.typed}</span>
                    <span className="cursor" />
                    <input
                      ref={inputRef} className="ghost-input" value={accept.typed}
                      onChange={(e) => setAccept({ ...accept, typed: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && submitTyped()}
                      autoFocus
                    />
                  </>
                ) : accept ? (
                  <span className="lst-accept">
                    {accept.cmd.name} — accepting {accept.spec.type.toUpperCase()} (point at a highlighted object)…
                  </span>
                ) : (
                  <><span>SATURN&gt;&nbsp;</span><span className="cursor" /></>
                )}
              </div>
            </div>
            <div className="lst-tag"><i>Dynamic Lisp Listener 2</i></div>
          </div>
        );
      })()}

      {/* ---------------------------- mouse doc line -------------------------- */}
      <div className="mousedoc">{accept ? acceptDoc(accept) : mouseDoc}</div>

      {/* ------------------------------ status line --------------------------- */}
      <div className="statusline">
        <span>
          [{clock.toDateString().slice(0, 3)} {clock.getDate()}{" "}
          {clock.toDateString().slice(4, 7)} {clock.toTimeString().slice(0, 8)}]
        </span>
        <span>david</span>
        <span>CL-USER:</span>
        <span>{accept ? `Accepting ${accept.spec.type?.toUpperCase() || "INPUT"}` : "User Input"}</span>
        <span>{viewMode === "wire" ? "WIREFRAME" : "PLOT"}</span>
        <span>SATURN {paused ? "· TELEMETRY PAUSED" : ""}</span>
      </div>

      {/* ------------------------------ popup menu ---------------------------- */}
      {menu && (
        <div className="popup" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="popup-title">{menu.title}</div>
          {menu.items.map((it) => (
            <div key={it.label} className="popup-item"
              onMouseEnter={() => setMouseDoc(cmdByName[it.label]?.doc || "")}
              onClick={() => startCommand(it.cmd, it.pres)}>
              {it.label}
              <span className="popup-args">
                {it.cmd.args.slice(it.pres ? 1 : 0).map((a) => ` (${a.type})`).join("")}
              </span>
            </div>
          ))}
          <div className="popup-item popup-abort" onClick={() => setMenu(null)}>Abort</div>
        </div>
      )}
    </div>
  );
}

/* ============================ 3D wireframe viewport ======================== */

function WireViewport({ gauges, cameraRef, presProps, io }) {
  const canvasRef = useRef(null);
  const gaugesRef = useRef(gauges);
  const ioRef = useRef(io);
  const anglesRef = useRef(NODES.map(() => JOINT_MAP.map((f) => f(45))));
  const hitsRef = useRef([]);
  const hoverRef = useRef(null);
  const dragRef = useRef(null);
  const [, force] = useState(0);

  gaugesRef.current = gauges;
  ioRef.current = io;

  /* RAF render loop — created once */
  useEffect(() => {
    let raf, alive = true;
    const t0 = Date.now();
    const loop = () => {
      if (!alive) return;
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
        }
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        /* smooth joint angles toward targets */
        const gs = gaugesRef.current;
        const tgt = NODES.map((node, c) =>
          JOINT_MAP.map((f, r) => {
            const g = gs.find((x) => x.row === r && x.col === c);
            return f(g ? g.value : 50);
          })
        );
        anglesRef.current = anglesRef.current.map((arm, c) =>
          arm.map((a, r) => a + (tgt[c][r] - a) * 0.08)
        );

        const acceptingGauge =
          ioRef.current.accept?.spec?.input === "presentation" &&
          (ioRef.current.accept.spec.type === "gauge" || ioRef.current.accept.spec.type === "any");

        hitsRef.current = renderScene(
          ctx, w, h, cameraRef.current, anglesRef.current, gs,
          {
            t: (Date.now() - t0) / 1000,
            acceptingGauge,
            hoverGaugeId: hoverRef.current,
          }
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [cameraRef]);

  /* wheel zoom (non-passive) */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const c = cameraRef.current;
      c.dist = Math.max(4, Math.min(30, c.dist * (e.deltaY > 0 ? 1.08 : 0.93)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [cameraRef]);

  const hitAt = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 16;
    for (const h of hitsRef.current) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  };

  const gaugePres = (id) => {
    const g = gaugesRef.current.find((x) => x.id === id);
    return g ? { key: `gauge3d-${g.id}`, ptype: "gauge", obj: g } : null;
  };

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onMouseMove = (e) => {
    const io2 = ioRef.current;
    if (dragRef.current && e.buttons & 1) {
      const d = dragRef.current;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
      const c = cameraRef.current;
      c.theta -= dx * 0.008;
      c.phi = Math.max(-0.1, Math.min(1.35, c.phi + dy * 0.006));
      d.x = e.clientX; d.y = e.clientY;
      io2.setMouseDoc("Orbiting camera…  release to stop.");
      hoverRef.current = null;
      return;
    }
    const hit = hitAt(e);
    if (hit?.gaugeId !== hoverRef.current) {
      hoverRef.current = hit ? hit.gaugeId : null;
      force((n) => n + 1);
    }
    if (hit) {
      if (io2.matches("gauge"))
        io2.setMouseDoc(`Mouse-L: ${hit.gaugeId} as ${io2.accept.spec.name.toUpperCase()} argument; Mouse-R: Abort.`);
      else
        io2.setMouseDoc(`Mouse-L: Select ${hit.gaugeId}; Mouse-R: Menu of GAUGE commands.`);
    } else if (!io2.accept) {
      io2.setMouseDoc("Mouse-L: Drag to orbit; Wheel: Zoom; Mouse-R: Viewport menu.");
    }
  };
  const onMouseUp = () => { dragRef.current = null; };
  const onClick = (e) => {
    const io2 = ioRef.current;
    if (dragRef.current?.moved) return;
    const hit = hitAt(e);
    if (hit && io2.matches("gauge")) {
      e.stopPropagation();
      io2.advance(io2.accept.cmd, [...io2.accept.args, gaugePres(hit.gaugeId)]);
    }
  };
  const onContextMenu = (e) => {
    const io2 = ioRef.current;
    const hit = hitAt(e);
    if (hit) {
      e.preventDefault();
      e.stopPropagation();
      if (io2.accept) return io2.abort();
      io2.openMenuFor(gaugePres(hit.gaugeId), e.clientX, e.clientY);
    }
    /* else: bubble up to the viewport window presentation */
  };

  const pres = { key: "win-viewport", ptype: "window", obj: { name: "VIEWPORT" } };
  return (
    <div {...presProps(pres, true)}>
      <div className="viewport">
        <canvas
          ref={canvasRef}
          className="wirecanvas"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onClick={onClick}
          onContextMenu={onContextMenu}
        />
        <div className="vp-corner">SARG — 3 ARMS · 18 DOF</div>
      </div>
    </div>
  );
}

/* ------------------------------ strip-chart view --------------------------- */

function PlotViewport({ plotted, paused, presProps }) {
  const W = 760, H = 430;
  const pres = { key: "win-viewport", ptype: "window", obj: { name: "VIEWPORT" } };
  const lanes = plotted.slice(0, 5);
  const laneH = lanes.length ? (H - 40) / lanes.length : 0;

  return (
    <div {...presProps(pres, true)}>
      <div className="viewport">
        <svg viewBox={`0 0 ${W} ${H}`} className="vp-svg" preserveAspectRatio="none">
          {lanes.map((g, i) => {
            const top = 24 + i * laneH;
            const bot = top + laneH - 14;
            const pts = g.history
              .map((v, j) => `${(j / (HISTORY - 1)) * (W - 40) + 12},${bot - (v / 100) * (laneH - 26)}`)
              .join(" ");
            const ay = bot - (g.alarm / 100) * (laneH - 26);
            return (
              <g key={g.id}>
                <line x1="12" y1={bot} x2={W - 28} y2={bot} stroke="#000" strokeWidth="1.5" />
                <line x1="12" y1={ay} x2={W - 28} y2={ay} stroke="#000" strokeWidth="1" strokeDasharray="3 4" />
                <polyline points={pts} fill="none" stroke="#000" strokeWidth="1.8" />
                <text x="14" y={top + 2} className="vp-label">
                  {g.name} @ {g.node} — {g.value.toFixed(1)}{g.value > g.alarm ? "  !ALARM" : ""}
                </text>
              </g>
            );
          })}
          {lanes.length === 0 && (
            <text x={W / 2} y={H / 2} textAnchor="middle" className="vp-empty">
              No OBJECT plotted — Mouse-R on a gauge and choose Plot Metric
            </text>
          )}
          {paused && (
            <text x={W / 2} y={16} textAnchor="middle" className="vp-label">— TELEMETRY PAUSED —</text>
          )}
        </svg>
      </div>
    </div>
  );
}

/* -------------------------------- Gauge dial ------------------------------- */

function Gauge({ g, presProps }) {
  const pres = { key: `gauge-${g.id}`, ptype: "gauge", obj: g };
  const alarmed = g.value > g.alarm;
  return (
    <div {...presProps(pres)}>
      <div className={"gauge" + (alarmed ? " gauge-alarm" : "")}>
        <svg viewBox="0 0 64 64" className="gauge-svg">
          <circle cx="32" cy="32" r="26" fill="#fff" stroke="#000" strokeWidth="2.5" />
          <path d={wedgePath(32, 32, 26, g.value / 100)} fill="#000" />
          <line
            x1="32" y1="32"
            x2={32 + 30 * Math.cos(-Math.PI / 2 + (g.alarm / 100) * 2 * Math.PI)}
            y2={32 + 30 * Math.sin(-Math.PI / 2 + (g.alarm / 100) * 2 * Math.PI)}
            stroke="#000" strokeWidth="1.5" strokeDasharray="2 2"
          />
          <line x1="32" y1="32" x2="58" y2="32" stroke="#000" strokeWidth="1.5" />
        </svg>
        {g.plotted && <div className="gauge-dot">▪</div>}
      </div>
    </div>
  );
}

/* ---------------------------------- CSS ----------------------------------- */

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body, #root { height: 100%; }

.frame {
  height: 100vh; display: flex; flex-direction: column;
  background: #fff; color: #000;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 12px; line-height: 1.35;
  user-select: none; overflow: hidden;
  border: 2px solid #000;
}

/* ---- presentations ---- */
.pres { position: relative; }
.pres-hover > * { outline: 2px solid #000; outline-offset: 1px; cursor: pointer; }
.quiet.pres-hover > * { outline: none; cursor: default; }
.pres-accepting > *, .quiet.pres-accepting > * {
  outline: 2px dashed #000 !important; outline-offset: 1px; cursor: crosshair;
  animation: ants 0.6s steps(2) infinite;
}
@keyframes ants { 50% { outline-color: transparent; } }

/* ---- menubar ---- */
.menubar { display: flex; border-bottom: 2px solid #000; }
.menubtn {
  flex: 1; padding: 5px 0; background: #fff; color: #000;
  border: none; border-right: 2px solid #000;
  font: inherit; font-weight: 700; letter-spacing: 2px; cursor: pointer;
}
.menubtn:hover { background: #000; color: #fff; }
.titlebox {
  flex: 1.3; padding: 5px 10px; font-weight: 700; letter-spacing: 1px;
  text-align: right; white-space: nowrap;
}

/* ---- middle ---- */
.mid { flex: 1.55; display: flex; min-height: 0; border-bottom: 2px solid #000; }
.mid > .pres:first-child { flex: 1; min-width: 0; border-right: 2px solid #000; }
.viewport { height: 100%; position: relative; }
.wirecanvas { width: 100%; height: 100%; display: block; touch-action: none; }
.vp-svg { width: 100%; height: 100%; display: block; }
.vp-label { font: 700 11px ui-monospace, Menlo, monospace; letter-spacing: 1px; fill: #000; }
.vp-empty { font: 12px ui-monospace, Menlo, monospace; fill: #000; letter-spacing: 1px; }
.vp-corner {
  position: absolute; left: 6px; top: 4px; font-size: 10px; font-weight: 700;
  letter-spacing: 1px; pointer-events: none; background: #fff; padding: 0 3px;
  border: 1px solid #000;
}

/* ---- gauges ---- */
.gaugepane {
  width: 232px; flex: none; display: grid;
  grid-template-rows: repeat(6, auto 1fr) auto;
  overflow: hidden;
}
.gaugerow-label, .gaugerow, .gaugefooter { display: grid; grid-template-columns: repeat(3, 1fr); }
.gl-cell {
  border: 1px solid #000; border-width: 0 1px 1px 0;
  font-size: 8.5px; font-weight: 700; letter-spacing: 0.5px;
  padding: 1px 2px; text-align: center; white-space: nowrap; overflow: hidden;
}
.gaugerow .pres { border-right: 1px solid #000; border-bottom: 1px solid #000; min-height: 0; }
.gauge { height: 100%; display: flex; align-items: center; justify-content: center; position: relative; padding: 1px; }
.gauge-svg { height: 100%; max-height: 58px; width: auto; }
.gauge-alarm { background: repeating-linear-gradient(45deg, #fff 0 3px, #000 3px 4px); }
.gauge-dot { position: absolute; right: 2px; top: 0; font-size: 10px; }
.gaugefooter .gf-cell {
  border-right: 1px solid #000; text-align: center; font-size: 9px; padding: 2px 0; font-weight: 700;
}

/* ---- lower: ports + event log ---- */
.lower { flex: 0.9; display: flex; min-height: 118px; border-bottom: 2px solid #000; }
.portgrid {
  flex: 1.5; display: grid; grid-template-columns: repeat(4, 1fr); grid-template-rows: 1fr 1fr;
  border-right: 2px solid #000;
}
.portgrid .pres { border-right: 2px solid #000; border-bottom: 2px solid #000; }
.portgrid .pres:nth-child(4n) { border-right: none; }
.portgrid .pres:nth-child(n+5) { border-bottom: none; }
.port { height: 100%; display: flex; flex-direction: column; }
.port-head {
  display: flex; justify-content: space-between; padding: 0 4px;
  border-bottom: 1.5px solid #000; font-weight: 700; font-size: 10px;
}
.port-body { flex: 1; display: flex; align-items: center; min-height: 0; }
.port-icon {
  width: 20px; align-self: stretch; display: flex; align-items: center; justify-content: center;
  background: repeating-linear-gradient(0deg, #fff 0 2px, #000 2px 3px);
  color: #fff; font-weight: 700; text-shadow: 0 0 2px #000;
  border-left: 1.5px solid #000; border-right: 1.5px solid #000;
}
.port-icon:first-child { border-left: none; }
.port-icon:last-child { border-right: none; }
.port-none { flex: 1; text-align: center; font-weight: 700; letter-spacing: 2px; }
.port-live { flex: 1; text-align: center; }
.port-name { font-weight: 700; font-size: 10px; letter-spacing: 1px; }
.port-sub { font-size: 9px; }
.port-val { font-weight: 700; font-size: 16px; }

.eventlog { flex: 1; min-width: 0; display: flex; }
.el-scroll { flex: 1; overflow-y: auto; padding: 3px 6px; }
.el-line { display: flex; gap: 6px; align-items: baseline; white-space: nowrap; font-size: 11px; }
.el-mark { width: 7px; height: 9px; background: #000; flex: none; align-self: center; }

/* ---- listener ---- */
.listener-inner { flex: 1.05; min-height: 110px; display: flex; flex-direction: column; position: relative; }
.lst-scroll { flex: 1; overflow-y: auto; padding: 4px 8px; cursor: text; }
.lst-line { white-space: pre-wrap; }
.lst-echo { font-weight: 700; }
.lst-err  { text-decoration: underline; }
.lst-accept { font-style: italic; font-weight: 700; }
.lst-prompt { display: flex; align-items: baseline; position: relative; }
.cursor {
  display: inline-block; width: 8px; height: 13px; background: #000;
  margin-left: 1px; animation: blink 1s steps(1) infinite; align-self: center;
}
@keyframes blink { 50% { opacity: 0; } }
.ghost-input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.lst-tag {
  position: absolute; right: 8px; bottom: 3px; font-size: 11px;
  background: #fff; padding: 0 4px; border: 1px solid #000;
}

/* ---- doc + status ---- */
.mousedoc {
  background: #000; color: #fff; padding: 3px 8px;
  font-weight: 700; letter-spacing: 0.5px; white-space: nowrap; overflow: hidden;
}
.statusline {
  display: flex; gap: 26px; padding: 2px 8px; border-top: 2px solid #000;
  font-size: 11px; white-space: nowrap; overflow: hidden;
}

/* ---- popup menu ---- */
.popup {
  position: fixed; z-index: 50; min-width: 230px;
  background: #fff; border: 2px solid #000; box-shadow: 5px 5px 0 #000;
}
.popup-title {
  background: #000; color: #fff; font-weight: 700; letter-spacing: 1px;
  padding: 3px 8px;
}
.popup-item { padding: 3px 8px; cursor: pointer; display: flex; justify-content: space-between; gap: 10px; }
.popup-item:hover { background: #000; color: #fff; }
.popup-args { opacity: 0.75; font-style: italic; }
.popup-abort { border-top: 1.5px solid #000; font-style: italic; }

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: #000; border: 2px solid #fff; }
::-webkit-scrollbar-track { background: #fff; }

@media (max-width: 900px) {
  .gaugepane { width: 168px; }
  .portgrid { grid-template-columns: repeat(2, 1fr); }
  .portgrid .pres:nth-child(4n) { border-right: 2px solid #000; }
  .portgrid .pres:nth-child(2n) { border-right: none; }
}
`;

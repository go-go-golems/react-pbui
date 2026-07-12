import React, { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";

/* ============================================================================
   PRESENTATION SYSTEM  (Genera Dynamic Windows / CLIM style)
   ----------------------------------------------------------------------------
   Every displayed object is a <Presentation type=... object=...>.
   - Right click  : menu of applicable commands (presentation translators)
   - Middle click : Describe object
   - Left click   : when an *input context* is active and the presentation's
                    type matches, the object is accepted as the argument.
   The pointer-documentation line at the bottom always tells you what the
   mouse buttons will do for the presentation under the cursor.
   ========================================================================== */

const INK = "#141410";
const PAPER = "#f4f3ec";

const PresCtx = createContext(null);

/* ------------------------------- utils ---------------------------------- */
let GID = 1;
const gid = () => GID++;
const fmt = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/* --------------------------- metric simulation --------------------------- */
const METRIC_DEFS = [
  { id: "CPU-LOAD", unit: "%", base: 46, amp: 30, noise: 9, threshold: 80 },
  { id: "MEM-USED", unit: "%", base: 62, amp: 10, noise: 3, threshold: 90 },
  { id: "NET-RX", unit: "MB/S", base: 24, amp: 18, noise: 8, threshold: 48 },
  { id: "DISK-IO", unit: "OPS", base: 130, amp: 70, noise: 30, threshold: 240 },
  { id: "GPU-TEMP", unit: "°C", base: 58, amp: 12, noise: 2.5, threshold: 78 },
  { id: "REQ-RATE", unit: "R/S", base: 310, amp: 160, noise: 55, threshold: 520 },
];

function nextSample(def, t) {
  const v =
    def.base +
    def.amp * Math.sin(t / 9 + def.base) +
    def.amp * 0.4 * Math.sin(t / 3.1 + def.id.length) +
    (Math.random() - 0.5) * 2 * def.noise;
  return Math.max(0, v);
}

/* ------------------------------ rule graph ------------------------------- */
/* A little decision network, like the RCS jet-failure net in the screenshot.
   Each edge carries a query; each query tests a metric against its threshold. */
const NODES = [
  { id: "N1", x: 90, y: 40 },
  { id: "N2", x: 250, y: 120, q: { m: "CPU-LOAD", op: ">" } },
  { id: "N3", x: 80, y: 210, q: { m: "CPU-LOAD", op: "<=" } },
  { id: "N4", x: 430, y: 60 },
  { id: "N5", x: 560, y: 150, q: { m: "MEM-USED", op: ">" } },
  { id: "N6", x: 400, y: 220, q: { m: "NET-RX", op: ">" } },
  { id: "N7", x: 620, y: 290, q: { m: "REQ-RATE", op: ">" } },
  { id: "N8", x: 250, y: 300, q: { m: "DISK-IO", op: ">" } },
  { id: "FIN1", x: 470, y: 360, circle: true },
  { id: "FIN2", x: 90, y: 370, circle: true },
];
const EDGES = [
  { from: "N1", to: "N2", label: (m) => ["(? (> ", m("CPU-LOAD"), " $THRESH))"] },
  { from: "N1", to: "N3", label: (m) => ["(? (~ (> ", m("CPU-LOAD"), " $THRESH)))"] },
  { from: "N4", to: "N5", label: (m) => ["(? (TYPE GAUGE ", m("MEM-USED"), "))"] },
  { from: "N4", to: "N6", label: (m) => ["(? (SATURATED ", m("NET-RX"), "))"] },
  { from: "N5", to: "N7", label: (m) => ["(? (> ", m("REQ-RATE"), " $THRESH))"], bold: true },
  { from: "N2", to: "N8", label: (m) => ["(? (BACKLOG ", m("DISK-IO"), "))"] },
  { from: "N6", to: "FIN1", label: () => ["(=> (LOSS-OF-CAPACITY $HOST))"] },
  { from: "N7", to: "FIN1", label: () => ["(! (WAIT-MCC-CALL \"RECONFIG\"))"] },
  { from: "N3", to: "FIN2", label: () => ["(=> (NOMINAL $HOST))"] },
  { from: "N8", to: "FIN2", label: (m) => ["(? (IN-SEQUENCE ", m("GPU-TEMP"), "))"] },
];

/* ============================ Presentation ================================ */
function Presentation({ type, object, children, block, className = "", style }) {
  const api = useContext(PresCtx);
  const [hover, setHover] = useState(false);
  const sensitive = api.inputCtx && api.inputCtx.type === type; // matches active input context
  const acceptable = sensitive;

  const doc = () => {
    if (acceptable) api.setPointerDoc(`L: select ${labelOf(type, object)} as ${type.toUpperCase()}   R: abort context`);
    else api.setPointerDoc(`${labelOf(type, object)} [${type}] — L,R: menu of commands   M: describe`);
  };

  const outline = acceptable
    ? hover
      ? `2px solid ${INK}`
      : `1.5px dashed ${INK}`
    : hover
      ? `1.5px solid ${INK}`
      : "1.5px solid transparent";

  const Tag = block ? "div" : "span";
  return (
    <Tag
      className={className}
      style={{ outline, outlineOffset: 1, cursor: "default", ...style }}
      onMouseEnter={() => { setHover(true); doc(); }}
      onMouseLeave={() => { setHover(false); api.setPointerDoc(null); }}
      onClick={(e) => {
        if (acceptable) { e.stopPropagation(); api.accept(object, type); }
        else { e.stopPropagation(); api.openMenu(e.clientX, e.clientY, type, object); }
      }}
      onAuxClick={(e) => {
        if (e.button === 1) { e.preventDefault(); e.stopPropagation(); api.describe(type, object); }
      }}
      onContextMenu={(e) => {
        e.preventDefault(); e.stopPropagation();
        if (api.inputCtx) { api.abort(); return; }
        api.openMenu(e.clientX, e.clientY, type, object);
      }}
    >
      {children}
    </Tag>
  );
}

function labelOf(type, object) {
  if (type === "metric") return object;
  if (type === "rule") return object;
  if (type === "chart") return `PLOT-${object}`;
  if (type === "query") return "QUERY";
  if (type === "command") return object;
  return String(object);
}

/* ================================= APP ==================================== */
export default function App() {
  /* ----- world state ----- */
  const [metrics, setMetrics] = useState(() => {
    const m = {};
    METRIC_DEFS.forEach((d) => {
      const data = [];
      for (let t = 0; t < 90; t++) data.push(nextSample(d, t));
      m[d.id] = { ...d, data, watched: d.id === "CPU-LOAD" };
    });
    return m;
  });
  const [traces, setTraces] = useState([
    { id: gid(), parts: [";; PRESENTATION METRICS SYSTEM 4.2 — trace pane"] },
  ]);
  const [ioLines, setIoLines] = useState([
    { id: gid(), parts: ["PES: (monitor :grid *metrics*)"] },
    { id: gid(), parts: ["((MONITOR STARTED))"] },
  ]);
  const [plots, setPlots] = useState([{ id: gid(), metricIds: ["CPU-LOAD"], style: "line" }]);
  const [running, setRunning] = useState(true);
  const [inputCtx, setInputCtx] = useState(null); // {type, prompt} | {type:'keyboard', prompt, accept}
  const [menu, setMenu] = useState(null); // {x,y,type,object}
  const [pointerDoc, setPointerDoc] = useState(null);
  const [kbd, setKbd] = useState("");
  const [clock, setClock] = useState(now());
  const tRef = useRef(90);
  const resolver = useRef(null);
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const ioEnd = useRef(null);
  const trEnd = useRef(null);

  /* ----- logging helpers ----- */
  const trace = useCallback((parts) => {
    setTraces((t) => [...t.slice(-120), { id: gid(), parts }]);
  }, []);
  const print = useCallback((parts) => {
    setIoLines((t) => [...t.slice(-120), { id: gid(), parts }]);
  }, []);

  useEffect(() => { ioEnd.current?.scrollIntoView({ block: "nearest" }); }, [ioLines, inputCtx]);
  useEffect(() => { trEnd.current?.scrollIntoView({ block: "nearest" }); }, [traces]);

  /* ----- input contexts (the heart of CLIM interaction) ----- */
  const prompt = useCallback((type, promptText, accept) => {
    return new Promise((resolve) => {
      resolver.current = resolve;
      setInputCtx({ type, prompt: promptText, accept });
      setKbd("");
    });
  }, []);
  const accept = useCallback((object) => {
    const r = resolver.current;
    resolver.current = null;
    setInputCtx(null);
    if (r) r(object);
  }, []);
  const abort = useCallback(() => {
    const r = resolver.current;
    resolver.current = null;
    setInputCtx(null);
    setKbd("");
    if (r) r(null);
    print([";; Aborted."]);
  }, [print]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && resolver.current) abort(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abort]);

  /* ----- metric token (a presentation used everywhere) ----- */
  const M = (id) => (
    <Presentation key={id + gid()} type="metric" object={id}>
      <b>{id}</b>
    </Presentation>
  );

  /* ----- simulation tick ----- */
  useEffect(() => {
    if (!running) return;
    const h = setInterval(() => {
      const t = tRef.current++;
      const prev = metricsRef.current;
      const nx = {};
      const events = [];
      for (const idm of Object.keys(prev)) {
        const mm = prev[idm];
        const v = nextSample(mm, t);
        const crossed = v > mm.threshold && mm.data[mm.data.length - 1] <= mm.threshold;
        nx[idm] = { ...mm, data: [...mm.data.slice(-89), v] };
        if (mm.watched && crossed) events.push({ idm, v, mm });
      }
      setMetrics(nx);
      events.forEach(({ idm, v, mm }) =>
        trace(["(? (> ", M(idm), ` ${mm.threshold})) => T   ;; value ${fmt(v)} ${mm.unit}`])
      );
      setClock(now());
    }, 900);
    return () => clearInterval(h);
  }, [running, trace]);

  /* ----- command implementations ----- */
  async function cmdDescribe(type, object) {
    if (type === "metric") {
      const m = metricsRef.current[object];
      const v = m.data[m.data.length - 1];
      print(["(DESCRIBE ", M(object), ")"]);
      print([`  ((TYPE GAUGE) (UNIT ${m.unit}) (VALUE ${fmt(v)}) (THRESHOLD ${m.threshold}) (WATCHED ${m.watched ? "T" : "NIL"}) (SAMPLES ${m.data.length}))`]);
    } else if (type === "rule") {
      const node = NODES.find((n) => n.id === object);
      print([`(DESCRIBE ${object})`]);
      if (node?.q) print(["  ((TYPE RULE-NODE) (TESTS ", M(node.q.m), `) (OP ${node.q.op}))`]);
      else print([`  ((TYPE ${node?.circle ? "TERMINAL" : "RULE-NODE"}) (STATUS ACTIVE))`]);
    } else if (type === "chart") {
      const p = plots.find((pp) => pp.id === object);
      print([`(DESCRIBE PLOT-${object})`, `  ;; style ${p?.style}, series (${p?.metricIds.join(" ")})`]);
    } else if (type === "query") {
      print(["(DESCRIBE QUERY) ;; edge test in the rule network — evaluate it from the menu"]);
    }
  }

  async function cmdPlot(metricId) {
    setPlots((p) => [...p.slice(-5), { id: gid(), metricIds: [metricId], style: "line" }]);
    print(["(PLOT ", M(metricId), ") ;; drawn in display pane"]);
  }

  async function cmdCompare(metricId) {
    print(["(COMPARE ", M(metricId), " WITH ...)"]);
    const other = await prompt("metric", `SELECT A METRIC TO COMPARE WITH ${metricId} (click one, or Escape)`);
    if (!other) return;
    setPlots((p) => [...p.slice(-5), { id: gid(), metricIds: [metricId, other], style: "line" }]);
    print(["((COMPARISON ", M(metricId), " ", M(other), ") PLOTTED)"]);
    trace(["(COMPARE ", M(metricId), " ", M(other), ")"]);
  }

  async function cmdSetThreshold(metricId) {
    const cur = metricsRef.current[metricId].threshold;
    const ans = await prompt("keyboard", `NEW THRESHOLD FOR ${metricId} [default ${cur}]:`, "number");
    if (ans === null) return;
    const v = parseFloat(ans);
    if (isNaN(v)) { print([`;; ${JSON.stringify(ans)} is not a number.`]); return; }
    setMetrics((mm) => ({ ...mm, [metricId]: { ...mm[metricId], threshold: v } }));
    print(["(SETF (THRESHOLD ", M(metricId), `) ${v})`]);
    trace(["(RETHRESHOLD ", M(metricId), ` ${v})`]);
  }

  async function cmdWatch(metricId, on) {
    setMetrics((mm) => ({ ...mm, [metricId]: { ...mm[metricId], watched: on } }));
    print([`(${on ? "WATCH" : "UNWATCH"} `, M(metricId), ")"]);
  }

  async function cmdStepRule(nodeId) {
    const node = NODES.find((n) => n.id === nodeId);
    if (!node) return;
    if (node.q) {
      const m = metricsRef.current[node.q.m];
      const v = m.data[m.data.length - 1];
      const res = node.q.op === ">" ? v > m.threshold : v <= m.threshold;
      trace([`(STEP ${nodeId}) (? (${node.q.op} `, M(node.q.m), ` ${m.threshold})) => ${res ? "T" : "NIL"}  ;; ${fmt(v)} ${m.unit}`]);
    } else {
      const ans = await prompt("keyboard", `IS RULE ${nodeId} ENABLED FOR THIS RUN? (YES OR NO):`, "yesno");
      if (ans === null) return;
      trace([`(STEP ${nodeId}) => ${/^y/i.test(ans) ? "T" : "NIL"}  ;; operator supplied`]);
    }
  }

  async function cmdEvalQuery(q) {
    const e = EDGES[q];
    const partsFn = e.label;
    const mIds = [];
    partsFn((idm) => { mIds.push(idm); return idm; });
    if (mIds.length === 0) { trace([`(EVAL EDGE ${e.from}->${e.to}) => T`]); return; }
    const idm = mIds[0];
    const m = metricsRef.current[idm];
    const v = m.data[m.data.length - 1];
    trace([`(EVAL EDGE ${e.from}->${e.to}) `, M(idm), ` = ${fmt(v)} ${m.unit} => ${v > m.threshold ? "T" : "NIL"}`]);
  }

  async function cmdRunAll() {
    const ans = await prompt("keyboard", "ENABLE CONTINUOUS TRACE OF ALL WATCHED METRICS? (YES OR NO):", "yesno");
    if (ans === null) return;
    const on = /^y/i.test(ans);
    setMetrics((mm) => {
      const nx = {};
      for (const k of Object.keys(mm)) nx[k] = { ...mm[k], watched: on };
      return nx;
    });
    print([`((TRACE ${on ? "ENABLED" : "DISABLED"} FOR ALL METRICS))`]);
  }

  async function cmdRemovePlot(plotId) {
    setPlots((p) => p.filter((pp) => pp.id !== plotId));
    print([`(REMOVE PLOT-${plotId})`]);
  }
  async function cmdStylePlot(plotId) {
    setPlots((p) => p.map((pp) => (pp.id === plotId ? { ...pp, style: pp.style === "line" ? "bar" : "line" } : pp)));
  }
  async function cmdAddSeries(plotId) {
    const other = await prompt("metric", "SELECT A METRIC TO ADD TO THIS PLOT (click one)");
    if (!other) return;
    setPlots((p) => p.map((pp) => (pp.id === plotId && !pp.metricIds.includes(other) ? { ...pp, metricIds: [...pp.metricIds, other] } : pp)));
    print(["((SERIES ", M(other), `) ADDED TO PLOT-${plotId})`]);
  }

  /* ----- command tables per presentation type ----- */
  function commandsFor(type, object) {
    if (type === "metric") {
      const w = metricsRef.current[object]?.watched;
      return [
        { name: "Describe Metric", run: () => cmdDescribe("metric", object) },
        { name: "Plot Metric", run: () => cmdPlot(object) },
        { name: "Compare Metric With…", run: () => cmdCompare(object) },
        { name: "Set Threshold…", run: () => cmdSetThreshold(object) },
        { name: w ? "Unwatch Metric" : "Watch Metric", run: () => cmdWatch(object, !w) },
      ];
    }
    if (type === "rule")
      return [
        { name: "Describe Rule", run: () => cmdDescribe("rule", object) },
        { name: "Step Rule", run: () => cmdStepRule(object) },
      ];
    if (type === "query")
      return [
        { name: "Evaluate Query", run: () => cmdEvalQuery(object) },
        { name: "Describe", run: () => cmdDescribe("query", object) },
      ];
    if (type === "chart")
      return [
        { name: "Describe Plot", run: () => cmdDescribe("chart", object) },
        { name: "Add Series…", run: () => cmdAddSeries(object) },
        { name: "Toggle Line/Bar", run: () => cmdStylePlot(object) },
        { name: "Remove Plot", run: () => cmdRemovePlot(object) },
      ];
    if (type === "background")
      return [
        { name: "Run All Rules Once", run: async () => { for (const n of NODES.filter((x) => x.q)) await cmdStepRule(n.id); } },
        { name: "Trace All / None…", run: () => cmdRunAll() },
        { name: "Clear Trace Pane", run: async () => setTraces([{ id: gid(), parts: [";; trace cleared"] }]) },
        { name: "Clear Listener", run: async () => setIoLines([{ id: gid(), parts: ["PES: "] }]) },
      ];
    return [];
  }

  /* ----- context api ----- */
  const api = {
    inputCtx,
    setPointerDoc,
    accept: (obj) => accept(obj),
    abort,
    describe: (t, o) => cmdDescribe(t, o),
    openMenu: (x, y, type, object) => setMenu({ x, y, type, object }),
  };

  /* ----- listener keyboard ----- */
  function submitKbd() {
    const text = kbd;
    setKbd("");
    if (inputCtx && inputCtx.type === "keyboard") {
      print([`${inputCtx.prompt} ${text}`]);
      accept(text);
      return;
    }
    // free-form mini evaluator
    print([`PES: ${text}`]);
    const t = text.trim().toUpperCase();
    const hit = Object.keys(metricsRef.current).find((k) => t.includes(k));
    if (hit) cmdDescribe("metric", hit);
    else if (t === "(RUN)") setRunning(true);
    else if (t === "(HALT)") setRunning(false);
    else if (t) print([`((UNBOUND ${t.split(" ")[0].replace(/[()]/g, "")})) ;; try right-clicking a presentation`]);
  }

  /* ----- rendering helpers ----- */
  const menuCmds = menu ? commandsFor(menu.type, menu.object) : [];

  return (
    <PresCtx.Provider value={api}>
      <div
        className="w-full h-screen flex flex-col select-none"
        style={{ background: PAPER, color: INK, fontFamily: "'Menlo','Consolas','Lucida Console',monospace", fontSize: 12, lineHeight: 1.35 }}
        onContextMenu={(e) => { e.preventDefault(); if (inputCtx) { abort(); return; } setMenu({ x: e.clientX, y: e.clientY, type: "background", object: null }); }}
        onClick={() => setMenu(null)}
      >
        {/* ============ TRACE PANE ============ */}
        <div className="overflow-y-auto px-2 py-1" style={{ height: "18%", borderBottom: `2px solid ${INK}` }}>
          {traces.map((l) => (
            <div key={l.id} className="whitespace-pre-wrap">{l.parts}</div>
          ))}
          <div ref={trEnd} />
          <div className="italic" style={{ marginTop: 2 }}>TRACE PANE</div>
        </div>

        {/* ============ GRAPH + DISPLAY PANES ============ */}
        <div className="flex flex-1 min-h-0">
          {/* rule network */}
          <div className="relative flex-1 min-w-0 overflow-hidden" style={{ borderRight: `2px solid ${INK}` }}>
            <svg viewBox="0 0 720 420" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
              {EDGES.map((e, i) => {
                const a = NODES.find((n) => n.id === e.from);
                const b = NODES.find((n) => n.id === e.to);
                return (
                  <g key={i}>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={INK} strokeWidth={e.bold ? 3.5 : 1.3} />
                    <polygon
                      points="0,-4 9,0 0,4"
                      fill={INK}
                      transform={`translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2}) rotate(${(Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI})`}
                    />
                  </g>
                );
              })}
            </svg>
            {/* HTML overlays for nodes + edge labels (so they can be presentations) */}
            <div className="absolute inset-0">
              {NODES.map((n) => (
                <div key={n.id} className="absolute" style={{ left: `${(n.x / 720) * 100}%`, top: `${(n.y / 420) * 100}%`, transform: "translate(-50%,-50%)" }}>
                  <Presentation type="rule" object={n.id}>
                    <span
                      className="px-1"
                      style={{
                        border: `1.5px solid ${INK}`,
                        borderRadius: n.circle ? "50%" : 0,
                        background: PAPER,
                        padding: n.circle ? "8px 6px" : "1px 5px",
                        fontWeight: 700,
                        fontSize: 11,
                        display: "inline-block",
                      }}
                    >
                      {n.circle ? n.id.replace("FIN", "FIN ") : n.id}
                    </span>
                  </Presentation>
                </div>
              ))}
              {EDGES.map((e, i) => {
                const a = NODES.find((n) => n.id === e.from);
                const b = NODES.find((n) => n.id === e.to);
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                const parts = e.label((idm) => (
                  <Presentation key={idm} type="metric" object={idm}>
                    <b>{idm}</b>
                  </Presentation>
                ));
                return (
                  <div
                    key={"lbl" + i}
                    className="absolute whitespace-nowrap"
                    style={{ left: `${(mx / 720) * 100}%`, top: `${(my / 420) * 100}%`, transform: "translate(-50%,-160%)", fontSize: 11, background: PAPER, padding: "0 2px" }}
                  >
                    <Presentation type="query" object={i}>{parts}</Presentation>
                  </div>
                );
              })}
              <div className="absolute italic" style={{ left: 6, bottom: 4 }}>RULE-NETWORK PANE</div>
            </div>
          </div>

          {/* display pane: metric grid + plots */}
          <div className="overflow-y-auto p-2" style={{ width: 340, flexShrink: 0 }}>
            <div style={{ borderBottom: `1.5px solid ${INK}`, marginBottom: 4, fontWeight: 700 }}>*METRICS*</div>
            {Object.values(metrics).map((m) => {
              const v = m.data[m.data.length - 1];
              const hot = v > m.threshold;
              return (
                <div key={m.id} className="flex items-baseline gap-2" style={{ padding: "1px 0" }}>
                  <Presentation type="metric" object={m.id}>
                    <b style={hot ? { background: INK, color: PAPER, padding: "0 3px" } : {}}>{m.id}</b>
                  </Presentation>
                  <span className="flex-1 text-right tabular-nums">{fmt(v)} {m.unit}</span>
                  <span style={{ opacity: 0.65 }}>/{m.threshold}</span>
                  <span>{m.watched ? "•" : " "}</span>
                </div>
              );
            })}
            <div style={{ borderBottom: `1.5px solid ${INK}`, margin: "8px 0 4px", fontWeight: 700 }}>DISPLAY PANE</div>
            {plots.length === 0 && <div className="italic">;; right-click a metric and choose Plot Metric</div>}
            {plots.map((p) => (
              <Presentation key={p.id} type="chart" object={p.id} block style={{ margin: "4px 0 10px" }}>
                <Chart plot={p} metrics={metrics} />
              </Presentation>
            ))}
          </div>
        </div>

        {/* ============ IO / LISTENER PANE ============ */}
        <div className="flex" style={{ borderTop: `2px solid ${INK}`, height: "24%" }}>
          {/* menu pane */}
          <div className="flex flex-col items-stretch p-1 gap-1" style={{ width: 90, borderRight: `2px solid ${INK}` }}>
            <div className="italic" style={{ fontSize: 10 }}>Menu Pane</div>
            {[
              { n: "STEP", f: async () => { for (const nd of NODES.filter((x) => x.q)) await cmdStepRule(nd.id); } },
              { n: running ? "HALT" : "RUN", f: () => { setRunning((r) => !r); print([`((CLOCK ${running ? "HALTED" : "RUNNING"}))`]); } },
              { n: "TRACE", f: () => cmdRunAll() },
              { n: "DONE", f: () => (inputCtx ? abort() : setMenu(null)) },
            ].map((b) => (
              <button
                key={b.n}
                className="text-center"
                style={{ border: `1.5px solid ${INK}`, background: PAPER, color: INK, fontFamily: "inherit", fontWeight: 700, fontSize: 11, padding: "1px 0" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = INK; e.currentTarget.style.color = PAPER; setPointerDoc(`L: ${b.n} — command menu item`); }}
                onMouseLeave={(e) => { e.currentTarget.style.background = PAPER; e.currentTarget.style.color = INK; setPointerDoc(null); }}
                onClick={(e) => { e.stopPropagation(); b.f(); }}
              >
                {b.n}
              </button>
            ))}
          </div>
          {/* listener */}
          <div className="flex-1 overflow-y-auto px-2 py-1" onClick={(e) => e.stopPropagation()}>
            {ioLines.map((l) => (
              <div key={l.id} className="whitespace-pre-wrap">{l.parts}</div>
            ))}
            {inputCtx && inputCtx.type !== "keyboard" && (
              <div style={{ background: INK, color: PAPER, padding: "0 4px", display: "inline-block" }}>
                {inputCtx.prompt} — matching presentations are boxed; Escape aborts
              </div>
            )}
            {(!inputCtx || inputCtx.type === "keyboard") && (
              <div className="flex gap-1">
                <span style={{ fontWeight: 700 }}>{inputCtx ? inputCtx.prompt : "PES:"}</span>
                <input
                  autoFocus
                  value={kbd}
                  onChange={(e) => setKbd(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitKbd(); }}
                  className="flex-1 outline-none"
                  style={{ background: "transparent", color: INK, fontFamily: "inherit", fontSize: 12, border: "none", borderBottom: `1px dotted ${INK}` }}
                  spellCheck={false}
                />
              </div>
            )}
            <div ref={ioEnd} />
            <div className="italic">IO PANE</div>
          </div>
        </div>

        {/* ============ POINTER DOCUMENTATION LINE ============ */}
        <div style={{ background: INK, color: PAPER, padding: "2px 8px", fontSize: 11, display: "flex", justifyContent: "space-between" }}>
          <span>
            {pointerDoc ||
              (inputCtx
                ? inputCtx.type === "keyboard"
                  ? "Type your answer in the listener and press Enter.  Escape: abort"
                  : `Accepting a ${inputCtx.type.toUpperCase()} — click a boxed presentation.  R/Escape: abort`
                : "L: Select   M: Describe   R: Menu of applicable commands")}
          </span>
          <span>{clock}  Singer   PES: {running ? "run" : "halt"}</span>
        </div>

        {/* ============ CONTEXT MENU ============ */}
        {menu && (
          <div
            className="fixed z-50"
            style={{
              left: Math.min(menu.x, window.innerWidth - 240),
              top: Math.min(menu.y, window.innerHeight - 40 - menuCmds.length * 22),
              background: PAPER,
              border: `2px solid ${INK}`,
              boxShadow: `4px 4px 0 ${INK}`,
              minWidth: 220,
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <div style={{ background: INK, color: PAPER, padding: "1px 6px", fontWeight: 700 }}>
              {menu.type === "background" ? "SYSTEM MENU" : `${labelOf(menu.type, menu.object)}  [${menu.type}]`}
            </div>
            {menuCmds.map((c) => (
              <div
                key={c.name}
                style={{ padding: "2px 8px", cursor: "default" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = INK; e.currentTarget.style.color = PAPER; setPointerDoc(`L: ${c.name}`); }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = INK; }}
                onClick={() => { setMenu(null); c.run(); }}
              >
                {c.name}
              </div>
            ))}
            <div
              style={{ padding: "2px 8px", borderTop: `1px solid ${INK}`, fontStyle: "italic" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = INK; e.currentTarget.style.color = PAPER; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = INK; }}
              onClick={() => setMenu(null)}
            >
              Abort
            </div>
          </div>
        )}
      </div>
    </PresCtx.Provider>
  );
}

/* ================================ CHART =================================== */
function Chart({ plot, metrics }) {
  const W = 300, H = 84, PAD = 4;
  const series = plot.metricIds.map((idm) => metrics[idm]).filter(Boolean);
  if (series.length === 0) return null;
  const all = series.flatMap((s) => s.data);
  const min = Math.min(...all, ...series.map((s) => s.threshold));
  const max = Math.max(...all, ...series.map((s) => s.threshold));
  const sx = (i, n) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const sy = (v) => H - PAD - ((v - min) / (max - min || 1)) * (H - 2 * PAD);
  const dashes = ["", "5,3", "1.5,2.5", "8,3,2,3"];
  return (
    <div style={{ border: `1.5px solid ${INK}`, background: PAPER }}>
      <div style={{ borderBottom: `1px solid ${INK}`, padding: "0 4px", fontSize: 10, display: "flex", justifyContent: "space-between" }}>
        <span>
          {series.map((s, i) => (
            <b key={s.id}>{i > 0 ? " + " : ""}{s.id}</b>
          ))}
        </span>
        <span>{fmt(series[0].data[series[0].data.length - 1])} {series[0].unit}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
        {series.map((s, si) => (
          <line key={"th" + si} x1={PAD} x2={W - PAD} y1={sy(s.threshold)} y2={sy(s.threshold)} stroke={INK} strokeWidth="0.8" strokeDasharray="2,2" opacity="0.7" />
        ))}
        {series.map((s, si) =>
          plot.style === "line" ? (
            <polyline
              key={s.id}
              fill="none"
              stroke={INK}
              strokeWidth={si === 0 ? 1.6 : 1.2}
              strokeDasharray={dashes[si % dashes.length]}
              points={s.data.map((v, i) => `${sx(i, s.data.length)},${sy(v)}`).join(" ")}
            />
          ) : (
            <g key={s.id}>
              {s.data.filter((_, i) => i % 3 === 0).map((v, i, arr) => (
                <rect key={i} x={sx(i, arr.length) - 1.4} y={sy(v)} width={2.8} height={H - PAD - sy(v)} fill={INK} opacity={si === 0 ? 1 : 0.45} />
              ))}
            </g>
          )
        )}
      </svg>
      <div style={{ borderTop: `1px solid ${INK}`, padding: "0 4px", fontSize: 9, display: "flex", justifyContent: "space-between" }}>
        <span>min {fmt(min)}</span>
        <span>thresh ┄</span>
        <span>max {fmt(max)}</span>
      </div>
    </div>
  );
}

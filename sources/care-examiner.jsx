import React, {
  useState, useEffect, useRef, useCallback, useMemo, createContext, useContext,
} from "react";

/* ------------------------------------------------------------------ *
 *  CARE EXAMINER — a presentation-based UI in the style of Symbolics
 *  Genera Dynamic Windows / CLIM.
 *
 *  Every visible object (a site, a service, an operator node, a legend
 *  swatch, a whole panel) is a PRESENTATION of a typed object.
 *   - Hover      : thin box outlines the presentation, the mouse
 *                  documentation line explains the gestures.
 *   - Mouse-L    : default action (Describe).
 *   - Mouse-R    : pop-up menu of commands applicable to that type.
 *   - Commands with arguments enter an ACCEPT loop: presentations of
 *     the requested type blink; click one (or type into the Listener)
 *     to supply the argument. Escape aborts.
 * ------------------------------------------------------------------ */

/* ---------------------------- dithers ----------------------------- */
const dot = (fg, r, s) => ({
  backgroundImage: `radial-gradient(circle, ${fg} ${r}px, transparent ${r + 0.3}px)`,
  backgroundSize: `${s}px ${s}px`,
});
const DITHER = [
  { backgroundColor: "#fff" },
  { backgroundColor: "#fff", ...dot("#000", 0.7, 7) },
  { backgroundColor: "#fff", ...dot("#000", 0.8, 5) },
  { backgroundColor: "#fff", ...dot("#000", 0.9, 4) },
  { backgroundColor: "#fff", ...dot("#000", 1.1, 3.2) },
  { backgroundColor: "#fff", ...dot("#000", 1.3, 3) },
  { backgroundColor: "#000", ...dot("#fff", 1.0, 3) },
  { backgroundColor: "#000", ...dot("#fff", 0.9, 4) },
  { backgroundColor: "#000", ...dot("#fff", 0.7, 6) },
  { backgroundColor: "#000" },
];
const ditherFor = (pct) => DITHER[Math.max(0, Math.min(9, Math.floor(pct / 10)))];

/* ------------------------------ data ------------------------------ */
const SITE_IDS = [
  [8, 8], [8, 6], [8, 2], [7, 8], [7, 4], [6, 8], [6, 4], [6, 2], [5, 8], [5, 4],
  [5, 2], [4, 4], [4, 2], [3, 8], [3, 6], [3, 4], [2, 8], [2, 2], [1, 8], [1, 2],
].map(([a, b]) => `(${a} ${b})`);

const HIST = 72;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const walk = (v, step, a, b) => clamp(v + rnd(-step, step), a, b);

function genSeries(seed, n = HIST, a = 0, b = 95, step = 14) {
  const out = []; let v = seed;
  for (let i = 0; i < n; i++) { v = walk(v, step, a, b); out.push(v); }
  return out;
}

const SERVICE_SEED = [
  ["NET-INPUT",   "(8 8)", 0.20, 13,    12.13],
  ["NET-OUTPUT",  "(8 6)", 0.13, 53,     2.09],
  ["EVALUATOR",   "(8 2)", 5.42, 53,     2.32],
  ["OPERATOR",    "(7 8)", 12.00, 13,    2.13],
  ["SG-CREATE",   "(7 4)", 9.63, 51,     1.05],
  ["SG-SWITCH",   "(6 8)", 7.36, 53,     1.06],
  ["PROC-CREATE", "(6 4)", 0.46, 779,    0.75],
  ["MICROSIM",    "(6 2)", 0.98, 777,    0.79],
  ["HARDCOPY",    "(5 8)", 0.26, 12099,  0.30],
  ["GC-SCAVENGE", "(5 4)", 1.98, 13,     0.98],
];

/* --------------------------- presentations ------------------------ */
const Ctx = createContext(null);
const typeMatch = (want, got) => want === "any" || want === got;

function Pres({ type, obj, label, block, className = "", style, children, title }) {
  const P = useContext(Ctx);
  const id = type + "|" + label;
  const accepting = P.accept && P.accept.spec && typeMatch(P.accept.spec.type, type);
  const hovered = P.hover && P.hover.id === id;
  const Tag = block ? "div" : "span";
  return (
    <Tag
      className={
        "pres " + className +
        (hovered ? " pres-hover" : "") +
        (accepting ? " pres-accept" : "")
      }
      style={style}
      title={title}
      onMouseMove={(e) => { e.stopPropagation(); if (!P.hover || P.hover.id !== id) P.setHover({ id, type, label, obj }); }}
      onClick={(e) => {
        e.stopPropagation();
        P.closeMenu();
        if (P.accept && P.accept.spec) {
          if (typeMatch(P.accept.spec.type, type)) P.supply({ type, label, obj });
          return;
        }
        P.defaultAction({ type, label, obj });
      }}
      onContextMenu={(e) => {
        e.preventDefault(); e.stopPropagation();
        P.openMenu(e.clientX, e.clientY, { type, label, obj });
      }}
    >
      {children}
    </Tag>
  );
}

/* ----------------------------- commands --------------------------- */
/* api: { print, world } — world exposes app state mutators/getters.  */
const fmt = (n, d = 1) => Number(n).toFixed(d);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const COMMANDS = [
  {
    name: "Describe", args: [{ name: "object", type: "any" }],
    run(api, [o]) {
      const { type, label, obj } = o;
      if (type === "site") {
        const h = api.world.siteHist(label) || [];
        api.print(`#<SITE ${label}> — evaluator queue at site ${label}`);
        api.print(`  load: ${fmt(h[h.length - 1] || 0)}%   mean: ${fmt(mean(h))}%   peak: ${fmt(Math.max(0, ...h))}%   samples: ${h.length}`);
      } else if (type === "service") {
        api.print(`#<SERVICE ${obj.name}> queue ${obj.queue}`);
        api.print(`  average: ${fmt(obj.avg, 2)} ms   runs: ${obj.runs}   delay: ${fmt(obj.delay, 2)} ms`);
      } else if (type === "operator") {
        api.print(`#<OPERATOR (${obj.row} ${obj.col})> torus node — queue load ${fmt(obj.load)}%`);
      } else if (type === "load-level") {
        api.print(`Dither swatch: presentations filled at this texture carry ${obj.pct}% queue load.`);
      } else if (type === "metric") {
        api.print(`#<METRIC-PANE "${obj.name}">  ${obj.desc || ""}`);
      } else if (type === "restart") {
        api.print(`A restart handler: ${label}. Invoking it resumes the interrupted process.`);
      } else {
        api.print(`#<${type.toUpperCase()} ${label}>`);
      }
    },
  },
  {
    name: "Inspect", args: [{ name: "object", type: "any" }],
    run(api, [o]) {
      api.print(`#<${o.type.toUpperCase()} ${o.label} 2100${Math.floor(rnd(1000, 9999))}> is an instance of ${o.type.toUpperCase()}:`);
      Object.entries(o.obj || {}).slice(0, 6).forEach(([k, v]) => {
        if (typeof v === "object") return;
        api.print(`   ${k.toUpperCase().padEnd(12)}: ${v}`);
      });
    },
  },
  {
    name: "Highlight Site", args: [{ name: "site", type: "site" }],
    run(api, [s]) {
      const on = api.world.toggleHighlight(s.label);
      api.print(`Site ${s.label} ${on ? "highlighted" : "un-highlighted"}.`);
    },
  },
  {
    name: "Compare Sites",
    args: [{ name: "first site", type: "site" }, { name: "second site", type: "site" }],
    run(api, [a, b]) {
      const ha = api.world.siteHist(a.label), hb = api.world.siteHist(b.label);
      const ma = mean(ha), mb = mean(hb);
      api.print(`Site ${a.label}: mean ${fmt(ma)}%    Site ${b.label}: mean ${fmt(mb)}%`);
      api.print(ma === mb ? "  Loads are balanced." : `  ${(ma > mb ? a : b).label} is carrying ${fmt(Math.abs(ma - mb))}% more load.`);
    },
  },
  {
    name: "Reset Site History", args: [{ name: "site", type: "site" }],
    run(api, [s]) { api.world.resetSite(s.label); api.print(`History for site ${s.label} cleared.`); },
  },
  {
    name: "Set Legend Threshold", args: [{ name: "level", type: "load-level" }],
    run(api, [l]) {
      api.world.setThreshold(l.obj.pct);
      api.print(`Threshold set to ${l.obj.pct}%. Sites at or above it show inverse-video labels.`);
    },
  },
  {
    name: "Ping Operator", args: [{ name: "operator", type: "operator" }],
    run(api, [o]) {
      api.print(`Pinging operator (${o.obj.row} ${o.obj.col}) …`);
      api.print(`  round trip ${fmt(rnd(0.4, 6), 2)} μs over ${1 + Math.floor(rnd(0, 4))} hops.`);
    },
  },
  {
    name: "Reset Service Counters", args: [{ name: "service", type: "service" }],
    run(api, [s]) { api.world.resetService(s.obj.name); api.print(`Counters for ${s.obj.name} zeroed.`); },
  },
  {
    name: "Set Update Interval", args: [{ name: "milliseconds", type: "number" }],
    run(api, [n]) {
      const ms = clamp(Math.round(n.obj.value), 100, 5000);
      api.world.setTickMs(ms);
      api.print(`Update interval set to ${ms} ms.`);
    },
  },
  { name: "Pause Simulation",  run(api) { api.world.setPaused(true);  api.print("Simulation paused."); } },
  { name: "Resume Simulation", run(api) { api.world.setPaused(false); api.print("Simulation resumed."); } },
  { name: "Clear Threshold",   run(api) { api.world.setThreshold(null); api.print("Threshold cleared."); } },
  { name: "Reset Statistics",  run(api) { api.world.resetAll(); api.print("All metric histories reset."); } },
  { name: "Clear Listener",    run(api) { api.world.clearListener(); } },
  {
    name: "Hardcopy Screen",
    run(api) {
      api.print(`[${new Date().toTimeString().slice(0, 8)} Process Simple's Hardcopy Process got an error`, "err");
      api.print(" Select Background Lisp Interactor 1 by typing Function-0-S.]", "err");
      api.print(">Breakpoint BREAK. Press [Resume] to continue or [Abort] to quit.", "err");
    },
  },
  {
    name: "Show Herald",
    run(api) {
      api.print("CARE Examiner 2.1  —  presentation-based metrics console");
      api.print("Dynamic Windows emulation: hover boxes presentations; Mouse-R menus;");
      api.print("commands accept typed arguments from blinking presentations or the keyboard.");
    },
  },
];

const objectCommands = (type) => COMMANDS.filter((c) => c.args && typeMatch(c.args[0].type, type) && c.args[0].type !== "number");
const globalCommands = () => COMMANDS.filter((c) => !c.args || c.args[0].type === "number");

/* ------------------------------ panels ---------------------------- */
function Panel({ title, sub, children, className = "", metric }) {
  const body = (
    <div className={"panel " + className}>
      <div className="ptitle">{title}</div>
      {sub && <div className="psub">{sub}</div>}
      <div className="pbody">{children}</div>
    </div>
  );
  return metric ? (
    <Pres type="metric" obj={metric} label={metric.name} block className="panel-pres">{body}</Pres>
  ) : body;
}

function LegendSwatch({ pct, threshold }) {
  return (
    <Pres type="load-level" obj={{ pct }} label={pct + "%"} block className="lg-row">
      <span className="lg-box" style={ditherFor(pct + 5)} />
      <span className="lg-lab">{pct} %{threshold === pct ? " ◄" : ""}</span>
    </Pres>
  );
}

function Sparkbars({ hist, max, h = 90, mid = false }) {
  return (
    <div className="spark" style={{ height: h }}>
      {hist.map((v, i) =>
        mid ? (
          <div key={i} className="bar-wrap">
            <div className="bar" style={{
              height: Math.abs(v) / max * (h / 2),
              marginTop: v >= 0 ? h / 2 - Math.abs(v) / max * (h / 2) : h / 2,
            }} />
          </div>
        ) : (
          <div key={i} className="bar-wrap">
            <div className="bar" style={{ height: (v / max) * h, marginTop: h - (v / max) * h }} />
          </div>
        )
      )}
    </div>
  );
}

/* ------------------------------- app ------------------------------ */
export default function CareExaminer() {
  /* ---- simulation state ---- */
  const [sites, setSites] = useState(() => SITE_IDS.map((id) => ({ id, hist: genSeries(rnd(5, 70)) })));
  const [services, setServices] = useState(() =>
    SERVICE_SEED.map(([name, queue, avg, runs, delay]) => ({ name, queue, avg, runs, delay })));
  const [ops, setOps] = useState(() =>
    Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => rnd(0, 80))));
  const [net, setNet] = useState(() => genSeries(40).map((v) => ({ load: v, lat: rnd(40, 420) })));
  const [pu, setPu]   = useState(() => genSeries(0, HIST, -25, 25, 8));
  const [sq, setSq]   = useState(() => ({ a: genSeries(18, HIST, 0, 31, 5), b: genSeries(3, HIST, 0, 8, 2) }));
  const [simT, setSimT] = useState(109.54);
  const [paused, setPaused] = useState(false);
  const [tickMs, setTickMs] = useState(450);
  const [highlights, setHighlights] = useState(() => new Set());
  const [threshold, setThreshold] = useState(null);
  const scatter = useMemo(() => {
    const pts = [];
    for (let i = 0; i < 320; i++) {
      const rank = Math.floor(Math.pow(Math.random(), 2) * 2500) + 1;
      const y = 24 * Math.exp(-rank / 260) + rnd(0, 2) + (Math.random() < 0.02 ? rnd(4, 18) : 0);
      pts.push([rank, Math.min(24, y)]);
    }
    return pts;
  }, []);

  /* ---- UI / command-loop state ---- */
  const [hover, setHover] = useState(null);
  const [menu, setMenu] = useState(null);           // {x,y,target|null,commands}
  const [accept, setAccept] = useState(null);       // {cmd,specs,collected,spec}
  const [lines, setLines] = useState([]);           // {text,kind}
  const [typed, setTyped] = useState("");
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const acceptRef = useRef(null); acceptRef.current = accept;

  const print = useCallback((text, kind = "out") =>
    setLines((ls) => [...ls.slice(-160), { text, kind }]), []);

  /* ---- world API handed to commands ---- */
  const sitesRef = useRef(sites); sitesRef.current = sites;
  const world = useMemo(() => ({
    siteHist: (id) => (sitesRef.current.find((s) => s.id === id) || {}).hist || [],
    toggleHighlight: (id) => {
      let on;
      setHighlights((h) => { const n = new Set(h); on = !n.has(id); on ? n.add(id) : n.delete(id); return n; });
      return on;
    },
    resetSite: (id) => setSites((ss) => ss.map((s) => (s.id === id ? { ...s, hist: [] } : s))),
    resetService: (name) => setServices((ss) => ss.map((s) => (s.name === name ? { ...s, runs: 0, avg: 0, delay: 0 } : s))),
    setThreshold, setPaused, setTickMs,
    resetAll: () => {
      setSites((ss) => ss.map((s) => ({ ...s, hist: [] })));
      setNet([]); setPu([]); setSq({ a: [], b: [] });
    },
    clearListener: () => setLines([]),
  }), []);
  const api = useMemo(() => ({ print, world }), [print, world]);

  /* ---- command loop ---- */
  const runCommand = useCallback((cmd, collected) => {
    setAccept(null);
    try { cmd.run(api, collected); } catch (e) { print("Error: " + e.message, "err"); }
  }, [api, print]);

  const advance = useCallback((cmd, specs, collected) => {
    if (collected.length >= specs.length) { runCommand(cmd, collected); return; }
    const spec = specs[collected.length];
    setAccept({ cmd, specs, collected, spec });
    print(`  ${spec.name} (a ${spec.type.toUpperCase()}) ⇒`, "prompt");
    if (spec.type === "number" && inputRef.current) inputRef.current.focus();
  }, [print, runCommand]);

  const startCommand = useCallback((cmd, initial) => {
    print(`Command: ${cmd.name}`, "echo");
    const specs = cmd.args || [];
    const collected = [];
    if (initial && specs[0] && typeMatch(specs[0].type, initial.type)) {
      collected.push(initial);
      print(`  ${specs[0].name} (a ${specs[0].type.toUpperCase()}) ⇒ ${initial.label}`, "prompt");
    }
    advance(cmd, specs, collected);
  }, [advance, print]);

  const supply = useCallback((o) => {
    const a = acceptRef.current; if (!a) return;
    print(`    ${o.label}`, "in");
    advance(a.cmd, a.specs, [...a.collected, o]);
  }, [advance, print]);

  const defaultAction = useCallback((o) => {
    startCommand(COMMANDS[0], o); // Describe
  }, [startCommand]);

  const openMenu = useCallback((x, y, target) => {
    const cmds = target ? objectCommands(target.type) : globalCommands();
    setMenu({ x: Math.min(x, window.innerWidth - 230), y: Math.min(y, window.innerHeight - 300), target, commands: cmds });
  }, []);

  /* escape aborts */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setMenu(null);
        if (acceptRef.current) { setAccept(null); print("Abort!", "err"); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [print]);

  /* ---- simulation tick ---- */
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => {
      setSites((ss) => ss.map((s) => ({
        ...s, hist: [...s.hist.slice(-(HIST - 1)), walk(s.hist[s.hist.length - 1] ?? rnd(10, 60), 14, 0, 95)],
      })));
      setNet((n) => [...n.slice(-(HIST - 1)), {
        load: walk(n[n.length - 1]?.load ?? 40, 12, 0, 70),
        lat: walk(n[n.length - 1]?.lat ?? 200, 60, 20, 450),
      }]);
      setPu((p) => [...p.slice(-(HIST - 1)), walk(p[p.length - 1] ?? 0, 7, -25, 25)]);
      setSq((q) => ({
        a: [...q.a.slice(-(HIST - 1)), walk(q.a[q.a.length - 1] ?? 15, 5, 0, 31)],
        b: [...q.b.slice(-(HIST - 1)), walk(q.b[q.b.length - 1] ?? 3, 2, 0, 9)],
      }));
      setOps((o) => o.map((row) => row.map((v) => walk(v, 10, 0, 95))));
      setServices((ss) => ss.map((s) => (Math.random() < 0.35 ? { ...s, runs: s.runs + 1 + Math.floor(rnd(0, 3)) } : s)));
      setSimT((t0) => t0 + 0.03);
    }, tickMs);
    return () => clearInterval(t);
  }, [paused, tickMs]);

  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [lines, accept]);

  /* ---- listener keyboard input ---- */
  const submitTyped = () => {
    const text = typed.trim(); setTyped("");
    if (!text) return;
    const a = acceptRef.current;
    if (a) {
      if (a.spec.type === "number") {
        const v = parseFloat(text);
        if (isNaN(v)) { print(`"${text}" is not a NUMBER. Try again, or press Escape.`, "err"); return; }
        supply({ type: "number", label: text, obj: { value: v } });
      } else if (a.spec.type === "site" && sitesRef.current.some((s) => s.id === text)) {
        const s = sitesRef.current.find((x) => x.id === text);
        supply({ type: "site", label: s.id, obj: s });
      } else {
        print(`Click a blinking ${a.spec.type.toUpperCase()} presentation${a.spec.type === "site" ? ", or type its name like (8 4)" : ""}.`, "err");
      }
      return;
    }
    const cmd = COMMANDS.find((c) => c.name.toLowerCase() === text.toLowerCase())
      || COMMANDS.find((c) => c.name.toLowerCase().startsWith(text.toLowerCase()));
    if (cmd) startCommand(cmd);
    else print(`Unknown command "${text}". Type "Show Herald" for help, or use Mouse-R menus.`, "err");
  };

  /* ---- mouse documentation line ---- */
  let mouseDoc;
  if (accept) {
    mouseDoc = accept.spec.type === "number"
      ? `Accepting a NUMBER — type it in the Listener and press Return.   [Escape] aborts.`
      : `Accepting a ${accept.spec.type.toUpperCase()} — Mouse-L on a blinking presentation supplies it.   [Escape] aborts.`;
  } else if (hover) {
    mouseDoc = `#<${hover.type.toUpperCase()} ${hover.label}>    Mouse-L: Describe;   Mouse-R: Menu of ${hover.type} commands.`;
  } else {
    mouseDoc = `Mouse-R: global command menu.   Type a command in the Listener.   Presentations box themselves under the mouse.`;
  }

  const closeMenu = useCallback(() => setMenu(null), []);
  const ctxValue = { hover, setHover, accept, supply, defaultAction, openMenu, closeMenu };
  const now = new Date();
  const nowStr = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${String(now.getFullYear()).slice(2)} ${now.toTimeString().slice(0, 8)}`;

  /* ------------------------------ render ---------------------------- */
  return (
    <Ctx.Provider value={ctxValue}>
      <div className="crt"
        onMouseMove={() => { if (hover) setHover(null); }}
        onContextMenu={(e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, null); }}
        onClick={() => setMenu(null)}
      >
        <style>{CSS}</style>
        <div className="screen">
          {/* ============ row 1+2 ============ */}
          <div className="grid-main">
            <div className="col-left">
              <Panel title="ACTIVITY BY CLASS" sub="Service/Queue Average (Runs) Delay"
                metric={{ name: "Activity by Class", desc: "per-service-class scheduling statistics." }}>
                {services.map((s) => (
                  <Pres key={s.name} type="service" obj={s} label={s.name} block className="svc-row">
                    <span className="svc-name">{s.name.padEnd(12, " ")}</span>
                    {s.queue} {fmt(s.avg, 2).padStart(6)} ({String(s.runs).padStart(5)}) {fmt(s.delay, 2)}
                  </Pres>
                ))}
              </Panel>
              <Panel title="ACTIVITY BY INSTANCE" sub="Service/Queue Average (Runs) Delay"
                metric={{ name: "Activity by Instance", desc: "per-instance scheduling statistics." }}>
                {services.map((s, i) => (
                  <Pres key={s.name} type="service" obj={s} label={s.name + " #" + (i + 1)} block className="svc-row inst">
                    #{i + 1} {s.name.padEnd(11, " ")} {s.queue} {fmt(s.avg * rnd(0.8, 1.2), 2).padStart(6)} ({String(s.runs).padStart(5)}) {fmt(s.delay, 2)} MULT
                  </Pres>
                ))}
              </Panel>
            </div>

            {/* ---- big queue-load chart ---- */}
            <Panel title="CARE EXAMINER:  EVALUATOR QUEUE LOAD" sub="R e c e n t   H i s t o r y   a n d   A v e r a g e   b y   S i t e"
              className="big" metric={{ name: "Evaluator Queue Load", desc: "recent queue load history per site; darker dither is heavier load." }}>
              <div className="qwrap">
                <div className="qaxis">{["S", "i", "t", "e"].map((c, i) => <span key={i}>{c}</span>)}</div>
                <div className="qrows">
                  {sites.map((s) => {
                    const cur = s.hist[s.hist.length - 1] || 0;
                    const hot = threshold != null && cur >= threshold;
                    const hi = highlights.has(s.id);
                    return (
                      <Pres key={s.id} type="site" obj={s} label={s.id} block className="qrow">
                        <span className={"qlabel" + (hi || hot ? " inv" : "")}>{s.id}</span>
                        <div className="qcells">
                          {s.hist.map((v, i) => <div key={i} className="qcell" style={ditherFor(v)} />)}
                        </div>
                      </Pres>
                    );
                  })}
                  <div className="qnow" />
                </div>
                <div className="qlegend">
                  {Array.from({ length: 10 }, (_, i) => (
                    <LegendSwatch key={i} pct={i * 10} threshold={threshold} />
                  ))}
                </div>
              </div>
              <div className="qx">
                <span>0.00</span>
                <span className="qxl">S i m u l a t e d&nbsp;&nbsp;T i m e&nbsp;&nbsp;[ns]</span>
                <span>{fmt(simT, 2)}</span>
              </div>
            </Panel>

            <div className="col-right">
              {/* ---- listener ---- */}
              <Panel title="LISP LISTENER" className="listener-panel"
                metric={{ name: "Lisp Listener", desc: "command loop; echoes commands and prompts for arguments." }}>
                <div className="listener" ref={listRef} onClick={(e) => { e.stopPropagation(); if (inputRef.current) inputRef.current.focus(); }}>
                  <div className="l-line dim">0.24010001</div>
                  <div className="l-line dim">[15:40:59 Process Simple's Hardcopy Process got an error</div>
                  <div className="l-line dim">&nbsp;Select Background Lisp Interactor 1 by typing Function-0-S.]</div>
                  <div className="l-line dim">&gt;Breakpoint BREAK. Press{" "}
                    <Pres type="restart" obj={{ action: "resume" }} label="Resume" className="chip">[Resume]</Pres> to continue or{" "}
                    <Pres type="restart" obj={{ action: "abort" }} label="Abort" className="chip">[Abort]</Pres> to quit.
                  </div>
                  {lines.map((l, i) => (
                    <div key={i} className={"l-line " + l.kind}>{l.text}</div>
                  ))}
                  <div className="l-input">
                    <span className="l-prompt">{accept ? "…" : "⇒"}</span>
                    <input
                      ref={inputRef} value={typed} spellCheck={false}
                      onChange={(e) => setTyped(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submitTyped(); }}
                      placeholder={accept
                        ? (accept.spec.type === "number" ? "type a number…" : `click a ${accept.spec.type}…`)
                        : "type a command…"}
                    />
                  </div>
                </div>
              </Panel>

              {/* ---- network load & latency ---- */}
              <Panel title="NETWORK LOAD & LATENCY" sub="Net Potential Offered Load"
                metric={{ name: "Network Load & Latency", desc: "offered load (bars, left axis %) and packet latency (ticks, right axis μs)." }}>
                <div className="net">
                  <div className="net-ax l">{["70", "56", "42", "28", "14", "0"].map((t) => <span key={t}>{t}</span>)}</div>
                  <div className="net-plot">
                    <Sparkbars hist={net.map((n) => n.load)} max={70} h={104} />
                    <div className="net-lat">
                      {net.map((n, i) => (
                        <div key={i} className="lat-col"><div className="lat-dot" style={{ marginTop: (1 - n.lat / 450) * 100 }} /></div>
                      ))}
                    </div>
                  </div>
                  <div className="net-ax r">{["450", "375", "300", "225", "150", "75", "0"].map((t) => <span key={t}>{t}</span>)}</div>
                </div>
                <div className="qx small"><span>36.1</span><span className="qxl">Simulated Time [ns]</span><span>{fmt(simT, 2)}</span></div>
              </Panel>
            </div>
          </div>

          {/* ============ row 3 ============ */}
          <div className="grid-bottom">
            <Panel title="CUMULATIVE LATENCIES" sub="Net-Operator-Evaluator-Run Time"
              metric={{ name: "Cumulative Latencies", desc: "latency in ms by context rank." }}>
              <div className="scatter">
                <div className="sc-ax">{["24", "16", "8", "0"].map((t) => <span key={t}>{t}</span>)}</div>
                <svg viewBox="0 0 260 100" preserveAspectRatio="none" className="sc-svg">
                  {scatter.map(([r, y], i) => (
                    <rect key={i} x={(r / 2500) * 258} y={100 - (y / 24) * 98} width="1.6" height="1.6" fill="#000" />
                  ))}
                </svg>
              </div>
              <div className="qx small"><span>1</span><span className="qxl">Context by Rank</span><span>2501</span></div>
            </Panel>

            <Panel title="PROCESSOR UTILIZATION" sub="Time Evaluators & Operators Busy"
              metric={{ name: "Processor Utilization", desc: "% deviation of busy time from steady state." }}>
              <div className="pu">
                <div className="sc-ax">{["25", "0", "25"].map((t, i) => <span key={i}>{t}</span>)}</div>
                <div className="pu-plot">
                  <Sparkbars hist={pu} max={25} h={96} mid />
                  <div className="pu-zero" />
                </div>
              </div>
              <div className="qx small"><span>0</span><span className="qxl">Resources Busy</span><span>64</span></div>
            </Panel>

            <Panel title="SYSTEM QUEUE LOAD" sub="Net+Operator+Evaluator Queues"
              metric={{ name: "System Queue Load", desc: "total queued work across the machine (upper: evaluators; lower: net)." }}>
              <div className="sq">
                <div className="sc-ax">{["31", "23", "15", "7", "-1"].map((t) => <span key={t}>{t}</span>)}</div>
                <svg viewBox="0 0 260 100" preserveAspectRatio="none" className="sc-svg">
                  <polyline fill="none" stroke="#000" strokeWidth="1.4"
                    points={sq.a.map((v, i) => `${(i / (HIST - 1)) * 260},${100 - (v / 32) * 98}`).join(" ")} />
                  <polyline fill="none" stroke="#000" strokeWidth="1"
                    points={sq.b.map((v, i) => `${(i / (HIST - 1)) * 260},${100 - (v / 32) * 98}`).join(" ")} />
                </svg>
              </div>
              <div className="qx small"><span /><span className="qxl">Simulated Time [ns]</span><span>{fmt(simT, 1)}</span></div>
            </Panel>

            <Panel title="NETWORK-OPERATOR MAP" sub="Operator QLoad & Network Activity"
              metric={{ name: "Network-Operator Map", desc: "torus of operator nodes, dithered by queue load." }}>
              <div className="map">
                <div className="map-grid">
                  {ops.map((row, r) => (
                    <div key={r} className="map-row">
                      {row.map((v, c) => (
                        <Pres key={c} type="operator" obj={{ row: r + 1, col: c + 1, load: v }} label={`(${r + 1} ${c + 1})`} block className="map-cell-wrap">
                          <div className="map-cell" style={ditherFor(v)} />
                        </Pres>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="map-legend">
                  {Array.from({ length: 10 }, (_, i) => <LegendSwatch key={i} pct={i * 10} threshold={threshold} />)}
                </div>
              </div>
            </Panel>
          </div>

          {/* ============ notes + doc lines ============ */}
          <div className="notes">
            <b>NOTES:</b><br />
            [{nowStr}] 8 DIRECTED Cycles, Process Creation 50.0μs, SG Creation 200.0μs, SG Switch 20.0μs,<br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Evaluation Override NIL μs, Evaluator Factor 1.00, Operator Word Touch Time 2.0μs
            {paused && <span className="inv">&nbsp;— SIMULATION PAUSED&nbsp;</span>}
          </div>
          <div className="mousedoc">{mouseDoc}</div>
          <div className="status">
            <span>{nowStr} delagi</span>
            <span>CARE-USER:&nbsp;&nbsp;&nbsp;{paused ? "Paused" : "Run"}</span>
            <span>HPP-3645-10's console — tick {tickMs} ms</span>
          </div>
        </div>

        {/* ============ context menu ============ */}
        {menu && (
          <div className="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            <div className="menu-title">
              {menu.target ? `#<${menu.target.type.toUpperCase()} ${menu.target.label}>` : "Global Commands"}
            </div>
            {menu.commands.map((c) => (
              <div key={c.name} className="menu-item"
                onClick={() => { setMenu(null); startCommand(c, menu.target || undefined); }}>
                {c.name}
                {c.args && c.args.length > (menu.target ? 1 : 0) ? " …" : ""}
              </div>
            ))}
            {menu.target && (
              <>
                <div className="menu-sep" />
                <div className="menu-item dim2" onClick={() => setMenu(null)}>Abort</div>
              </>
            )}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

/* ------------------------------- css ------------------------------ */
const CSS = `
  .crt {
    min-height: 100vh; background: #9a9a9a; padding: 14px;
    font-family: "Menlo","Consolas","Lucida Console",monospace;
    font-size: 11px; line-height: 1.35; color: #000;
    -webkit-font-smoothing: none; user-select: none;
  }
  .crt *, .crt *::before, .crt *::after { box-sizing: border-box; }
  .screen {
    background: #fff; border: 3px solid #000; max-width: 1360px; margin: 0 auto;
    box-shadow: 6px 6px 0 #000;
  }

  /* layout */
  .grid-main { display: grid; grid-template-columns: 300px 1fr 320px; }
  .col-left, .col-right { display: flex; flex-direction: column; }
  .col-left > .panel-pres, .col-right > .panel-pres, .col-left > .panel, .col-right > .panel { flex: 1; display:flex; }
  .grid-bottom { display: grid; grid-template-columns: 1fr 1fr 1.1fr 1.3fr; border-top: 2px solid #000; }
  .panel-pres { display: flex; }
  .panel { border: 1px solid #000; padding: 4px 6px 6px; display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .panel.big { }
  .ptitle { text-align: center; font-weight: 700; letter-spacing: 1px; font-size: 12px; }
  .psub { text-align: center; font-style: italic; font-weight: 600; font-size: 10px; margin-bottom: 3px; }
  .pbody { flex: 1; min-height: 0; display: flex; flex-direction: column; }

  /* presentations */
  .pres { cursor: default; }
  .pres-hover { outline: 1.5px solid #000; outline-offset: 1px; cursor: pointer; }
  .pres-accept { outline: 2px dashed #000; outline-offset: 1px; animation: blink .5s steps(2, start) infinite; cursor: pointer; }
  @keyframes blink { to { outline-color: transparent; } }
  @media (prefers-reduced-motion: reduce) { .pres-accept { animation: none; } }
  .inv { background: #000; color: #fff; }

  /* service tables */
  .svc-row { white-space: pre; font-size: 10px; padding: 0 2px; }
  .svc-row.inst { font-size: 9.5px; }
  .svc-name { font-weight: 700; }

  /* queue load chart */
  .qwrap { display: flex; gap: 6px; flex: 1; }
  .qaxis { display: flex; flex-direction: column; justify-content: space-around; font-weight: 700; padding-bottom: 4px; }
  .qrows { flex: 1; position: relative; display: flex; flex-direction: column; gap: 2px; }
  .qrow { display: flex; align-items: stretch; gap: 4px; flex: 1; min-height: 11px; }
  .qlabel { width: 40px; text-align: right; font-size: 9.5px; line-height: 11px; }
  .qcells { flex: 1; display: flex; border: 1px solid #000; }
  .qcell { flex: 1; }
  .qnow { position: absolute; right: 13%; top: 0; bottom: 0; width: 2px; background: #000; pointer-events: none; }
  .qlegend { width: 74px; display: flex; flex-direction: column; justify-content: space-between; }
  .lg-row { display: flex; align-items: center; gap: 4px; padding: 1px; }
  .lg-box { width: 30px; height: 13px; border: 1px solid #000; flex: none; }
  .lg-lab { font-size: 9.5px; white-space: nowrap; }
  .qx { display: flex; justify-content: space-between; font-weight: 700; margin-top: 3px; }
  .qx .qxl { letter-spacing: 1px; }
  .qx.small { font-weight: 600; font-size: 9.5px; margin-top: 2px; }

  /* listener */
  .listener-panel .pbody { min-height: 0; }
  .listener { flex: 1; overflow-y: auto; min-height: 170px; max-height: 240px; padding: 2px; cursor: text; }
  .l-line { white-space: pre-wrap; word-break: break-word; }
  .l-line.dim { opacity: .75; }
  .l-line.echo { font-weight: 700; }
  .l-line.prompt { font-style: italic; }
  .l-line.in { font-weight: 700; }
  .l-line.err { background: #000; color: #fff; padding: 0 2px; }
  .chip { border: 1px solid #000; padding: 0 2px; font-weight: 700; }
  .l-input { display: flex; gap: 4px; align-items: center; }
  .l-prompt { font-weight: 700; }
  .l-input input {
    flex: 1; border: none; outline: none; background: transparent;
    font: inherit; color: inherit; padding: 0; caret-color: #000;
  }
  .l-input input::placeholder { color: #777; font-style: italic; }

  /* network panel */
  .net { display: flex; gap: 3px; flex: 1; }
  .net-ax { display: flex; flex-direction: column; justify-content: space-between; font-size: 9px; text-align: right; }
  .net-plot { position: relative; flex: 1; border: 1px solid #000; }
  .net-lat { position: absolute; inset: 0; display: flex; }
  .lat-col { flex: 1; height: 104px; }
  .lat-dot { width: 100%; height: 2px; background: #000; }
  .spark { display: flex; align-items: flex-end; }
  .bar-wrap { flex: 1; height: 100%; }
  .bar { background: #000; width: 100%; }

  /* bottom row plots */
  .scatter, .pu, .sq { display: flex; gap: 3px; flex: 1; min-height: 104px; }
  .sc-ax { display: flex; flex-direction: column; justify-content: space-between; font-size: 9px; text-align: right; width: 18px; }
  .sc-svg { flex: 1; border: 1px solid #000; height: 104px; width: 100%; }
  .pu-plot { position: relative; flex: 1; border: 1px solid #000; }
  .pu-zero { position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: #000; }

  /* map */
  .map { display: flex; gap: 8px; flex: 1; }
  .map-grid { display: flex; flex-direction: column; gap: 3px; justify-content: center; }
  .map-row { display: flex; gap: 3px; }
  .map-cell-wrap { display: block; }
  .map-cell { width: 17px; height: 13px; border: 1.5px solid #000; }
  .map-legend { display: flex; flex-direction: column; justify-content: space-between; }

  /* notes / doc / status */
  .notes { border-top: 2px solid #000; padding: 3px 8px; font-size: 10.5px; }
  .mousedoc {
    background: #000; color: #fff; padding: 2px 8px; font-size: 11px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .status { display: flex; justify-content: space-between; padding: 2px 8px; font-size: 10.5px; }

  /* menu */
  .menu {
    position: fixed; z-index: 50; background: #fff; border: 2px solid #000;
    box-shadow: 4px 4px 0 #000; min-width: 200px; font-size: 11px;
  }
  .menu-title { background: #000; color: #fff; padding: 2px 8px; font-weight: 700; white-space: nowrap; }
  .menu-item { padding: 2px 8px; cursor: pointer; white-space: nowrap; }
  .menu-item:hover { background: #000; color: #fff; }
  .menu-item.dim2 { font-style: italic; }
  .menu-sep { border-top: 1px solid #000; margin: 2px 0; }

  @media (max-width: 1100px) {
    .grid-main { grid-template-columns: 1fr; }
    .grid-bottom { grid-template-columns: 1fr 1fr; }
    .screen { box-shadow: none; }
  }
`;

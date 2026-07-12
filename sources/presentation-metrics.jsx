import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ============================================================================
   PRESENTA — Metrics II
   A CLIM / Genera Dynamic-Windows style presentation-based UI in React.

   Core ideas implemented from CLIM:
   - Every object on screen is a *presentation* of a typed object.
   - Hovering a presentation highlights it (box) and updates the mouse-doc line.
   - Mouse-R on a presentation pops a menu of commands applicable to its type.
   - Commands have typed arguments; when a command needs more arguments the UI
     enters an "accepting" input state: presentations matching the wanted type
     light up and become clickable, or the Listener prompts for keyboard input.
   - A Dynamic Lisp Listener echoes commands and prints output.
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
        plotted: r === 0 && c === 0, // start with one plotted
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

/* ------------------------------- command table ---------------------------- */
/* argTypes: input 'presentation' (click a presentation of matching ptype)
             or 'number' / 'string' (typed at the Listener prompt).           */

const COMMANDS = [
  {
    name: "Describe Object",
    args: [{ name: "object", type: "any", input: "presentation" }],
    doc: "Print a description of any presented object.",
  },
  {
    name: "Inspect",
    args: [{ name: "object", type: "any", input: "presentation" }],
    doc: "Show the slots of any presented object.",
  },
  {
    name: "Plot Metric",
    args: [{ name: "gauge", type: "gauge", input: "presentation" }],
    doc: "Add a metric's history to the strip-chart viewport.",
  },
  {
    name: "Remove From Plot",
    args: [{ name: "gauge", type: "gauge", input: "presentation" }],
    doc: "Remove a metric from the strip-chart viewport.",
  },
  {
    name: "Set Metric Value",
    args: [
      { name: "gauge", type: "gauge", input: "presentation" },
      { name: "value", type: "number", input: "number", prompt: "Value [0..100]" },
    ],
    doc: "Force a metric to a value (keyboard input at the Listener).",
  },
  {
    name: "Set Alarm Level",
    args: [
      { name: "gauge", type: "gauge", input: "presentation" },
      { name: "level", type: "number", input: "number", prompt: "Alarm level [0..100]" },
    ],
    doc: "Set the alarm threshold for a metric.",
  },
  {
    name: "Reset Peak",
    args: [{ name: "gauge", type: "gauge", input: "presentation" }],
    doc: "Reset a metric's recorded peak value.",
  },
  {
    name: "Assign Port",
    args: [
      { name: "port", type: "port", input: "presentation" },
      { name: "gauge", type: "gauge", input: "presentation" },
    ],
    doc: "Wire a metric into a readout port. Two typed arguments, both by pointing.",
  },
  {
    name: "Free Port",
    args: [{ name: "port", type: "port", input: "presentation" }],
    doc: "Disconnect a readout port.",
  },
  {
    name: "Hardcopy Window",
    args: [{ name: "window", type: "window", input: "presentation" }],
    doc: "Send a pane to the (imaginary) LGP-2 laser printer.",
  },
  { name: "Pause Telemetry", args: [], global: true, doc: "Freeze the simulated telemetry stream." },
  { name: "Resume Telemetry", args: [], global: true, doc: "Resume the simulated telemetry stream." },
  { name: "Clear Output History", args: [], global: true, doc: "Clear the Listener." },
  { name: "Show Commands", args: [], global: true, doc: "List the command table." },
];

const cmdByName = Object.fromEntries(COMMANDS.map((c) => [c.name, c]));

function commandsFor(ptype) {
  return COMMANDS.filter(
    (c) => c.args.length > 0 && (c.args[0].type === ptype || c.args[0].type === "any")
  );
}

/* --------------------------------- helpers -------------------------------- */

function wedgePath(cx, cy, r, frac) {
  if (frac <= 0.002) return "";
  if (frac >= 0.998) frac = 0.998;
  const a0 = -Math.PI / 2;
  const a1 = a0 + frac * 2 * Math.PI;
  const large = frac > 0.5 ? 1 : 0;
  return `M ${cx} ${cy} L ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)}
          A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} Z`;
}

function describe(p) {
  const o = p.obj;
  switch (p.ptype) {
    case "gauge":
      return [
        `#<GAUGE ${o.id}>`,
        `  A telemetry channel of class METRIC-GAUGE.`,
        `  Current value ${o.value.toFixed(1)}, peak ${o.peak.toFixed(1)}, alarm at ${o.alarm}.`,
        `  ${o.plotted ? "Currently plotted in the viewport." : "Not plotted."}`,
      ];
    case "port":
      return [
        `#<PORT ${o.index}>`,
        o.gaugeId
          ? `  Readout port wired to ${o.gaugeId}.`
          : `  Readout port, unconnected.  "No Port".`,
      ];
    case "window":
      return [`#<DYNAMIC-WINDOW ${o.name}>`, `  A pane of the frame PRESENTA-METRICS-II.`];
    case "command":
      return [`#<COMMAND ${o.name}>`, `  ${o.doc || ""}`];
    default:
      return [`#<OBJECT ${JSON.stringify(o)}>`];
  }
}

function inspect(p) {
  const o = p.obj;
  const rows = Object.entries(o)
    .filter(([k, v]) => typeof v !== "object" || v === null)
    .map(([k, v]) => `    ${k.toUpperCase().padEnd(10)} ${typeof v === "number" ? v.toFixed ? +v.toFixed(2) : v : v}`);
  return [`Inspecting #<${p.ptype.toUpperCase()} ${o.id || o.name || o.index || ""}>`, ...rows];
}

/* ================================== APP ==================================== */

export default function App() {
  const [gauges, setGauges] = useState(makeGauges);
  const [ports, setPorts] = useState(() =>
    Array.from({ length: 8 }, (_, i) => ({ id: `PORT-${i}`, index: i, gaugeId: null }))
  );
  const [paused, setPaused] = useState(false);
  const [lines, setLines] = useState([
    { t: "out", s: "Genera-style presentation frame loaded." },
    { t: "out", s: "Loading... MetricsII:Worlds;DEMO-4-CHANNELS" },
    { t: "out", s: "Mouse-R on any object for its command menu." },
  ]);
  const [events, setEvents] = useState([{ s: "18 channels attached from COM-LOAD" }]);
  const [menu, setMenu] = useState(null); // {x,y,title,items:[{label,disabled,cmd,pres}]}
  const [accept, setAccept] = useState(null); // {cmd, args:[], argIndex, typed:""}
  const [mouseDoc, setMouseDoc] = useState("Mouse-R: Main Menu.");
  const [hoverId, setHoverId] = useState(null);
  const [clock, setClock] = useState(new Date());
  const [angle, setAngle] = useState(0);
  const inputRef = useRef(null);
  const listenerRef = useRef(null);

  /* ------------------------------ simulation ------------------------------ */
  useEffect(() => {
    const id = setInterval(() => {
      setGauges((gs) => {
        const next = gs.map((g) => stepGauge(g, paused));
        next.forEach((g, i) => {
          const prev = gs[i];
          if (prev.value <= prev.alarm && g.value > g.alarm) {
            setEvents((e) =>
              [{ s: `ALARM ${g.id} crossed ${g.alarm} (${g.value.toFixed(1)})` }, ...e].slice(0, 40)
            );
          }
        });
        return next;
      });
      setAngle((a) => a + 0.03);
    }, 650);
    return () => clearInterval(id);
  }, [paused]);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    listenerRef.current?.scrollTo(0, 1e9);
  }, [lines, accept]);

  const say = useCallback((...ss) => {
    setLines((l) => [...l, ...ss.map((s) => (typeof s === "string" ? { t: "out", s } : s))]);
  }, []);

  /* ------------------------------ command exec ---------------------------- */
  const execute = useCallback(
    (cmd, args) => {
      const label = (a) =>
        a == null
          ? "NIL"
          : a.ptype
          ? a.obj.id || a.obj.name || `PORT-${a.obj.index}`
          : String(a);
      setLines((l) => [
        ...l,
        { t: "echo", s: `Command: ${cmd.name} ${args.map(label).join(" ")}` },
      ]);

      const g = (a) => a && a.ptype === "gauge" && a.obj.id;

      switch (cmd.name) {
        case "Describe Object":
          say(...describe(args[0]));
          break;
        case "Inspect":
          say(...inspect(args[0]));
          break;
        case "Plot Metric": {
          const id = g(args[0]);
          setGauges((gs) => gs.map((x) => (x.id === id ? { ...x, plotted: true } : x)));
          say(`${id} added to viewport plot.`);
          break;
        }
        case "Remove From Plot": {
          const id = g(args[0]);
          setGauges((gs) => gs.map((x) => (x.id === id ? { ...x, plotted: false } : x)));
          say(`${id} removed from viewport plot.`);
          break;
        }
        case "Set Metric Value": {
          const id = g(args[0]);
          const v = Math.max(0, Math.min(100, args[1]));
          setGauges((gs) =>
            gs.map((x) =>
              x.id === id
                ? { ...x, value: v, peak: Math.max(x.peak, v), history: x.history.slice(1).concat(v) }
                : x
            )
          );
          say(`${id} forced to ${v}.`);
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
          say(
            `Hardcopy of ${args[0].obj.name} queued to LGP-2 on SATURN.`,
            `1 request in queue; estimated 40 seconds.`
          );
          break;
        case "Pause Telemetry":
          setPaused(true);
          say("Telemetry stream paused.");
          break;
        case "Resume Telemetry":
          setPaused(false);
          say("Telemetry stream resumed.");
          break;
        case "Clear Output History":
          setLines([]);
          break;
        case "Show Commands":
          say(
            "Command table PRESENTA-METRICS-II:",
            ...COMMANDS.map(
              (c) => `  ${c.name.padEnd(22)} (${c.args.map((a) => a.type).join(", ") || "—"})`
            )
          );
          break;
        default:
          say({ t: "err", s: `No handler for ${cmd.name}` });
      }
    },
    [say]
  );

  /* --------------------- argument acceptance state machine ---------------- */
  const advance = useCallback(
    (cmd, args) => {
      if (args.length >= cmd.args.length) {
        setAccept(null);
        execute(cmd, args);
        return;
      }
      const spec = cmd.args[args.length];
      setAccept({ cmd, args, spec, typed: "" });
      if (spec.input !== "presentation") setTimeout(() => inputRef.current?.focus(), 0);
    },
    [execute]
  );

  const startCommand = useCallback(
    (cmd, firstPres) => {
      setMenu(null);
      // CLIM behavior: the presentation you invoked the menu on supplies arg 0.
      const args = [];
      if (firstPres && cmd.args.length > 0) {
        const s = cmd.args[0];
        if (s.type === "any" || s.type === firstPres.ptype) args.push(firstPres);
      }
      advance(cmd, args);
    },
    [advance]
  );

  const abort = useCallback(() => {
    if (accept) {
      setAccept(null);
      say({ t: "err", s: "Command aborted." });
    }
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
    (ptype) => wanted != null && (wanted === "any" || wanted === ptype),
    [wanted]
  );

  const presProps = useCallback(
    (pres) => ({
      onMouseEnter: () => {
        setHoverId(pres.key);
        const nm = pres.obj.id || pres.obj.name || `PORT-${pres.obj.index}`;
        if (matches(pres.ptype))
          setMouseDoc(`Mouse-L: ${nm} as ${accept.spec.name.toUpperCase()} argument; Mouse-R: Abort.`);
        else
          setMouseDoc(`Mouse-L: Select ${nm}; Mouse-R: Menu of ${pres.ptype.toUpperCase()} commands.`);
      },
      onMouseLeave: () => {
        setHoverId((h) => (h === pres.key ? null : h));
        setMouseDoc(accept ? acceptDoc(accept) : "Mouse-R: Main Menu.");
      },
      onClick: (e) => {
        if (matches(pres.ptype)) {
          e.stopPropagation();
          advance(accept.cmd, [...accept.args, pres]);
        }
      },
      onContextMenu: (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (accept) return abort();
        const cmds = commandsFor(pres.ptype);
        setMenu({
          x: Math.max(0, Math.min(e.clientX, window.innerWidth - 240)),
          y: Math.max(0, Math.min(e.clientY, window.innerHeight - 26 * (cmds.length + 2))),
          title: pres.obj.id || pres.obj.name || `PORT-${pres.obj.index}`,
          items: cmds.map((c) => ({ label: c.name, cmd: c, pres })),
        });
      },
      className:
        "pres" +
        (hoverId === pres.key ? " pres-hover" : "") +
        (matches(pres.ptype) ? " pres-accepting" : ""),
    }),
    [accept, hoverId, matches, advance, abort]
  );

  function acceptDoc(a) {
    return a.spec.input === "presentation"
      ? `Accepting an object of type ${a.spec.type.toUpperCase()} — point at a highlighted presentation. Escape: Abort.`
      : `Type ${a.spec.name} at the Listener, then Return. Escape: Abort.`;
  }

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

  /* -------------------------------- menubar -------------------------------- */
  const openGlobalMenu = (e, title, names) => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({
      x: r.left,
      y: r.bottom + 2,
      title,
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
          x: Math.min(e.clientX, window.innerWidth - 250),
          y: Math.min(e.clientY, window.innerHeight - 340),
          title: "Main Menu",
          items: COMMANDS.filter((c) => c.global || c.args[0]?.input === "presentation")
            .slice(0, 10)
            .map((c) => ({ label: c.name, cmd: c, pres: null })),
        });
      }}
    >
      <style>{CSS}</style>

      {/* ------------------------------ menubar ------------------------------ */}
      <div className="menubar">
        {[
          ["FILE", ["Hardcopy Window", "Clear Output History"]],
          ["TELEM", ["Pause Telemetry", "Resume Telemetry"]],
          ["PLOT", ["Plot Metric", "Remove From Plot"]],
          ["HELP", ["Show Commands"]],
        ].map(([t, names]) => (
          <button key={t} className="menubtn" onClick={(e) => { e.stopPropagation(); openGlobalMenu(e, t, names); }}>
            {t.split("").join(" ")}
          </button>
        ))}
        <div className="titlebox">PRESENTA — Metrics II</div>
      </div>

      <div className="mid">
        {/* ------------------------------ viewport ---------------------------- */}
        <Viewport
          plotted={plotted}
          angle={angle}
          paused={paused}
          presProps={presProps}
        />

        {/* ----------------------------- gauge grid --------------------------- */}
        <div className="gaugepane">
          {METRIC_ROWS.map((name, r) => (
            <React.Fragment key={name}>
              <div className="gaugerow-label" style={{ gridRow: r * 2 + 1 }}>
                {NODES.map((node) => (
                  <div key={node} className="gl-cell">{name}</div>
                ))}
              </div>
              <div className="gaugerow" style={{ gridRow: r * 2 + 2 }}>
                {gauges
                  .filter((g) => g.row === r)
                  .map((g) => (
                    <Gauge key={g.id} g={g} presProps={presProps} />
                  ))}
              </div>
            </React.Fragment>
          ))}
          <div className="gaugefooter">
            {NODES.map((n) => (
              <div key={n} className="gf-cell"><i>{n}</i></div>
            ))}
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
              <div key={i} className="el-line">
                <span className="el-mark" /> {e.s}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------- listener ----------------------------- */}
      <div
        className="listener"
        onClick={() => inputRef.current?.focus()}
        {...(() => {
          const pres = { key: "win-listener", ptype: "window", obj: { name: "LISTENER" } };
          const p = presProps(pres);
          // keep listener clickable for focus; merge handlers
          const orig = p.onClick;
          return { ...p, onClick: (e) => { orig(e); inputRef.current?.focus(); }, className: "listener-inner " + p.className };
        })()}
      >
        <div className="lst-scroll" ref={listenerRef}>
          {lines.map((l, i) => (
            <div key={i} className={"lst-line lst-" + l.t}>{l.s}</div>
          ))}
          <div className="lst-prompt">
            {accept && accept.spec.input !== "presentation" ? (
              <>
                <span className="lst-accept">
                  {accept.cmd.name} — {accept.spec.prompt || accept.spec.name}:&nbsp;
                </span>
                <span>{accept.typed}</span>
                <span className="cursor" />
                <input
                  ref={inputRef}
                  className="ghost-input"
                  value={accept.typed}
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
              <>
                <span>SATURN&gt;&nbsp;</span>
                <span className="cursor" />
              </>
            )}
          </div>
        </div>
        <div className="lst-tag"><i>Dynamic Lisp Listener 2</i></div>
      </div>

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
        <span>SATURN {paused ? "· TELEMETRY PAUSED" : ""}</span>
      </div>

      {/* ------------------------------ popup menu ---------------------------- */}
      {menu && (
        <div className="popup" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="popup-title">{menu.title}</div>
          {menu.items.map((it) => (
            <div
              key={it.label}
              className="popup-item"
              onMouseEnter={() => setMouseDoc(cmdByName[it.label]?.doc || "")}
              onClick={() => startCommand(it.cmd, it.pres)}
            >
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
          {/* alarm tick */}
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

/* ------------------------------ Viewport pane ------------------------------ */

function Viewport({ plotted, angle, paused, presProps }) {
  const W = 760, H = 430;
  const pres = { key: "win-viewport", ptype: "window", obj: { name: "VIEWPORT" } };

  // wireframe cube (decorative, rotating)
  const cube = useMemo(() => {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      let x = i & 1 ? 1 : -1, y = i & 2 ? 1 : -1, z = i & 4 ? 1 : -1;
      const c = Math.cos(angle), s = Math.sin(angle);
      const c2 = Math.cos(angle * 0.7), s2 = Math.sin(angle * 0.7);
      let X = x * c - z * s, Z = x * s + z * c;
      let Y = y * c2 - Z * s2; Z = y * s2 + Z * c2;
      const d = 3.4 / (Z + 3.4 + 1.2);
      pts.push([W - 92 + X * 52 * d, 84 + Y * 52 * d]);
    }
    const E = [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]];
    return E.map(([a, b]) => [pts[a], pts[b]]);
  }, [angle]);

  const lanes = plotted.slice(0, 5);
  const laneH = lanes.length ? (H - 40) / lanes.length : 0;

  return (
    <div {...presProps(pres)}>
      <div className="viewport">
        <svg viewBox={`0 0 ${W} ${H}`} className="vp-svg" preserveAspectRatio="none">
          {/* cube */}
          {cube.map(([[x1, y1], [x2, y2]], i) => (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#000" strokeWidth="1.4" />
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
                <line x1="12" y1={bot} x2={W - 118} y2={bot} stroke="#000" strokeWidth="1.5" />
                <line x1="12" y1={ay} x2={W - 118} y2={ay} stroke="#000" strokeWidth="1" strokeDasharray="3 4" />
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
            <text x={W / 2} y={26} textAnchor="middle" className="vp-label">— TELEMETRY PAUSED —</text>
          )}
        </svg>
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
.pres-accepting > * {
  outline: 2px dashed #000; outline-offset: 1px; cursor: crosshair;
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
.viewport { height: 100%; }
.mid > .pres:first-child { flex: 1; min-width: 0; border-right: 2px solid #000; }
.vp-svg { width: 100%; height: 100%; display: block; }
.vp-label { font: 700 11px ui-monospace, Menlo, monospace; letter-spacing: 1px; fill: #000; }
.vp-empty { font: 12px ui-monospace, Menlo, monospace; fill: #000; letter-spacing: 1px; }

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
.gauge-alarm svg circle { fill: #fff; }
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
.listener-inner { flex: 1.05; min-height: 110px; }
.listener-inner > .lst-scroll { border: none; }
.listener-inner { display: flex; flex-direction: column; position: relative; }
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

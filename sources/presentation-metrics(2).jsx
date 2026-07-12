import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";

/* ------------------------------------------------------------------ */
/*  PRESENTATION-METRICS + TASK-DISPATCH  (v3)                        */
/*  CLIM / Dynamic-Windows style dashboard with an agent cooperation  */
/*  system. Everything on screen is a typed *presentation*; commands  */
/*  accept typed arguments across panes.                              */
/*                                                                    */
/*  v3: resizable windows · task plans as editable/runnable DAGs ·    */
/*  filterable EVENT views · RESULT windows for finished tasks.       */
/* ------------------------------------------------------------------ */

const UICtx = createContext(null);

/* ----------------------------- metrics --------------------------- */

const METRIC_DEFS = [
  { id: "cpu",  name: "CPU-LOAD",    unit: "%",     cat: "SYSTEM",  base: 45,  jitter: 9,  min: 0 },
  { id: "mem",  name: "MEM-USED",    unit: "MB",    cat: "SYSTEM",  base: 900, jitter: 40, min: 200 },
  { id: "disk", name: "DISK-IO",     unit: "ops",   cat: "SYSTEM",  base: 120, jitter: 35, min: 0 },
  { id: "rx",   name: "NET-RX",      unit: "kb/s",  cat: "NETWORK", base: 300, jitter: 90, min: 0 },
  { id: "tx",   name: "NET-TX",      unit: "kb/s",  cat: "NETWORK", base: 180, jitter: 60, min: 0 },
  { id: "lat",  name: "LATENCY-P99", unit: "ms",    cat: "SERVICE", base: 80,  jitter: 22, min: 5 },
  { id: "err",  name: "ERROR-RATE",  unit: "/min",  cat: "SERVICE", base: 4,   jitter: 3,  min: 0 },
  { id: "qd",   name: "QUEUE-DEPTH", unit: "tasks", cat: "AGENTS",  base: 4,   jitter: 1,  min: 0, derived: true },
  { id: "tp",   name: "THROUGHPUT",  unit: "/min",  cat: "AGENTS",  base: 5,   jitter: 1,  min: 0, derived: true },
];
const CATS = ["SYSTEM", "NETWORK", "SERVICE", "AGENTS"];
const HISTORY_LEN = 60;

function genSeries(def) {
  const out = []; let v = def.base;
  for (let i = 0; i < HISTORY_LEN; i++) {
    v = Math.max(def.min, v + (Math.random() - 0.5) * def.jitter);
    out.push(v);
  }
  return out;
}
const nextPoint = (def, prev) => Math.max(def.min, prev + (Math.random() - 0.5) * def.jitter);
const fmt = (v) => (v >= 100 ? Math.round(v).toString() : (+v).toFixed(1));
const SPARK = "▁▂▃▄▅▆▇█";
const rnd = (a, b) => Math.round(a + Math.random() * (b - a));

/* ------------------------ agents & tasks ------------------------- */

const AGENT_DEFS = [
  { id: "a-s1", name: "SCRAPER-1", takes: ["SCRAPE", "CRAWL"] },
  { id: "a-s2", name: "SCRAPER-2", takes: ["SCRAPE", "CRAWL"] },
  { id: "a-p1", name: "PARSER-1",  takes: ["PARSE", "EXTRACT"] },
  { id: "a-i1", name: "INDEXER-1", takes: ["INDEX"] },
  { id: "a-w1", name: "WATCHDOG",  takes: ["MONITOR", "REPORT"] },
];
const TASK_KINDS = ["SCRAPE", "CRAWL", "PARSE", "EXTRACT", "INDEX", "MONITOR", "REPORT"];
const PRIOS = ["URGENT", "HIGH", "NORMAL", "LOW"];
const PRIO_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const EVENT_KINDS = ["ALL", "ASSIGN", "DONE", "FAIL", "SPAWN", "USER"];
const TARGET_POOL = [
  "surfline.com/spots", "swellinfo.net/buoys", "tidecharts.org/ri",
  "noaa.gov/wavecast", "boardshop.biz/catalog", "reefcam.tv/streams",
  "windfetch.io/atlantic", "longboard.wiki/history",
];
const HEADLINE_POOL = [
  "Dawn patrol: 4ft clean at Ruggles", "Buoy 44097 reads 6.2ft @ 9s",
  "Longboard swap meet, Narragansett", "Hurricane swell window opens Fri",
  "Point break cam back online", "Wax review: tropical vs cool water",
  "Tide push at 14:40, light offshore", "Board shaper interview, part 2",
];

/* ---- task results, generated when a task finishes ---- */
function makeResult(task) {
  const pick = (pool, n) => {
    const out = []; const src = [...pool];
    while (out.length < n && src.length) out.push(src.splice(Math.floor(Math.random() * src.length), 1)[0]);
    return out;
  };
  switch (task.kind) {
    case "SCRAPE": return {
      kv: { pages: rnd(4, 40), items: rnd(30, 400), payload: rnd(80, 900) + " kB", "http errors": rnd(0, 3) },
      rows: pick(HEADLINE_POOL, 4).map((h) => "« " + h + " »"),
    };
    case "CRAWL": return {
      kv: { "urls found": rnd(20, 220), depth: rnd(2, 5), duplicates: rnd(0, 30) },
      rows: [1, 2, 3, 4].map((i) => task.target + "/p/" + rnd(100, 999)),
    };
    case "PARSE": return {
      kv: { records: rnd(25, 380), skipped: rnd(0, 12), schema: "v" + rnd(1, 3) },
      rows: [1, 2, 3].map(() => "record #" + rnd(1000, 9999) + "  ok"),
    };
    case "EXTRACT": return {
      kv: { fields: rnd(4, 14), rows: rnd(20, 300), nulls: rnd(0, 9) + "%" },
      rows: ["swell_ht", "period_s", "wind_kt", "tide_ft"].slice(0, rnd(2, 4)).map((f) => f + " → float"),
    };
    case "INDEX": return {
      kv: { docs: rnd(25, 380), segments: rnd(1, 6), "index size": rnd(1, 40) + " MB" },
      rows: ["segment _" + rnd(10, 99) + " committed", "merged " + rnd(1, 4) + " segments"],
    };
    case "MONITOR": return {
      kv: { samples: rnd(40, 240), breaches: rnd(0, 4), worst: fmt(60 + Math.random() * 90) + " ms" },
      rows: ["window 60s, poll 900ms", "notify: listener"],
    };
    case "REPORT": return {
      kv: { sections: rnd(3, 8), words: rnd(300, 2400), charts: rnd(0, 4) },
      rows: ["§ summary", "§ throughput", "§ failures", "§ appendix"].slice(0, rnd(2, 4)),
    };
    default: return { kv: { status: "ok" }, rows: [] };
  }
}

const initialPlans = () => [
  { id: "pl-1", name: "SURFLINE-PIPELINE" },
];

const initialTasks = () => [
  { id: "T-101", kind: "SCRAPE",  target: "surfline.com/spots",    prio: "NORMAL", status: "DONE",    agentId: null,  progress: 100, deps: [], planId: "pl-1",
    result: { kv: { pages: 18, items: 122, payload: "312 kB", "http errors": 0 }, rows: ["« Dawn patrol: 4ft clean at Ruggles »", "« Buoy 44097 reads 6.2ft @ 9s »", "« Tide push at 14:40, light offshore »"] } },
  { id: "T-102", kind: "PARSE",   target: "surfline.com/spots",    prio: "NORMAL", status: "RUNNING", agentId: "a-p1", progress: 45,  deps: ["T-101"], planId: "pl-1" },
  { id: "T-103", kind: "INDEX",   target: "surfline.com/spots",    prio: "NORMAL", status: "BLOCKED", agentId: null,  progress: 0,   deps: ["T-102"], planId: "pl-1" },
  { id: "T-104", kind: "SCRAPE",  target: "noaa.gov/wavecast",     prio: "HIGH",   status: "RUNNING", agentId: "a-s1", progress: 68,  deps: [], planId: null },
  { id: "T-105", kind: "SCRAPE",  target: "reefcam.tv/streams",    prio: "HIGH",   status: "QUEUED",  agentId: null,  progress: 0,   deps: [], planId: null },
  { id: "T-106", kind: "MONITOR", target: "LATENCY-P99",           prio: "NORMAL", status: "RUNNING", agentId: "a-w1", progress: 25,  deps: [], planId: null },
  { id: "T-107", kind: "REPORT",  target: "daily-digest",          prio: "LOW",    status: "QUEUED",  agentId: null,  progress: 0,   deps: [], planId: null },
  { id: "T-108", kind: "CRAWL",   target: "boardshop.biz/catalog", prio: "URGENT", status: "QUEUED",  agentId: null,  progress: 0,   deps: [], planId: null },
  { id: "T-109", kind: "EXTRACT", target: "noaa.gov/wavecast",     prio: "NORMAL", status: "FAILED",  agentId: null,  progress: 62,  deps: [], planId: null },
];

const initialAgents = () =>
  AGENT_DEFS.map((d) => ({ ...d, taskId: null, paused: false, done: 0, failed: 0 }));

const STATUS_CLASS = {
  RUNNING: "c-teal", DONE: "", QUEUED: "", BLOCKED: "c-gold", DRAFT: "draft",
  FAILED: "c-coral", ABORTED: "c-coral", PAUSED: "c-gold", BUSY: "c-teal", IDLE: "",
};
const STATUS_GLYPH = { RUNNING: "»", DONE: "✓", QUEUED: "·", BLOCKED: "⊘", DRAFT: "◦", FAILED: "✗", ABORTED: "✗" };
const PRIO_CLASS = { URGENT: "c-coral", HIGH: "c-gold", NORMAL: "", LOW: "" };
const KIND_CLASS = { FAIL: "c-coral", USER: "c-gold" };
const bar = (p) => { const n = Math.round(p / 12.5); return "▓".repeat(n) + "░".repeat(8 - n); };
const hhmmss = (d = new Date()) => d.toLocaleTimeString([], { hour12: false });

/* --------------------- presentation helpers ---------------------- */

const specMatches = (spec, pres) => spec.type === "any" || spec.type === pres.type;

function presProps(ui, pres) {
  const eligible = ui.accepting && specMatches(ui.accepting.spec, pres);
  return {
    eligible,
    props: {
      onMouseEnter: () => ui.setHoverDoc(pres),
      onMouseLeave: () => ui.setHoverDoc(null),
      onClick: (e) => {
        e.stopPropagation(); ui.notePointer(e);
        if (ui.accepting) { if (eligible) ui.supplyArg(pres); }
        else ui.defaultAction(pres);
      },
      onAuxClick: (e) => {
        if (e.button === 1) { e.preventDefault(); e.stopPropagation(); if (!ui.accepting) ui.describe(pres); }
      },
      onContextMenu: (e) => {
        e.preventDefault(); e.stopPropagation(); ui.notePointer(e);
        if (ui.accepting) ui.abort();
        else ui.openCommandMenu(e.clientX, e.clientY, pres);
      },
    },
  };
}

function P({ type, object, label, block, className = "", children }) {
  const ui = useContext(UICtx);
  const { props, eligible } = presProps(ui, { type, object, label });
  const Tag = block ? "div" : "span";
  return (
    <Tag {...props}
      className={`pres ${eligible ? "eligible" : ""} ${ui.accepting && !eligible ? "inert" : ""} ${className}`}>
      {children}
    </Tag>
  );
}

function PG({ type, object, label, className = "", children }) {
  const ui = useContext(UICtx);
  const { props, eligible } = presProps(ui, { type, object, label });
  return (
    <g {...props}
      className={`pres-g ${eligible ? "eligible" : ""} ${ui.accepting && !eligible ? "inert" : ""} ${className}`}>
      {children}
    </g>
  );
}

/* --------------------------- panes ------------------------------- */

function TreePane({ metrics, panel }) {
  const W = 388, H = 284;
  const catY = { SYSTEM: 42, NETWORK: 112, SERVICE: 182, AGENTS: 248 };
  const leaves = {};
  CATS.forEach((c) => (leaves[c] = metrics.filter((m) => m.cat === c)));
  return (
    <svg width={Math.max(60, panel.w - 20)} height={Math.max(60, panel.h - 46)}
      viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="tree-svg">
      {CATS.map((c) => (
        <line key={c} x1={64} y1={H / 2} x2={170} y2={catY[c]} stroke="#000" strokeWidth="2.5" />
      ))}
      {CATS.map((c) =>
        leaves[c].map((m, i) => {
          const ly = catY[c] + (i - (leaves[c].length - 1) / 2) * 24;
          return <line key={m.id} x1={202} y1={catY[c]} x2={284} y2={ly} stroke="#000" strokeWidth="1.5" />;
        })
      )}
      <PG type="category" object="METRICS" label="METRICS">
        <ellipse className="nodedisc" cx={40} cy={H / 2} rx={38} ry={26} />
        <text className="disctext" x={40} y={H / 2 + 4} textAnchor="middle">|C|METRICS</text>
      </PG>
      {CATS.map((c) => (
        <PG key={c} type="category" object={c} label={c}>
          <ellipse className="nodedisc" cx={168} cy={catY[c]} rx={34} ry={20} />
          <text className="disctext" x={168} y={catY[c] + 4} textAnchor="middle">{"|C|" + c}</text>
        </PG>
      ))}
      {CATS.map((c) =>
        leaves[c].map((m, i) => {
          const ly = catY[c] + (i - (leaves[c].length - 1) / 2) * 24;
          const w = m.name.length * 7.4 + 14;
          return (
            <PG key={m.id} type="metric" object={m.id} label={m.name}>
              <rect className="nodebox" x={286} y={ly - 10} width={w} height={20} />
              <text className="boxtext" x={293} y={ly + 4}>{m.name}</text>
            </PG>
          );
        })
      )}
    </svg>
  );
}

function TablePane({ metrics, seriesMap, thresholds }) {
  return (
    <table className="mtable">
      <thead>
        <tr><th>METRIC</th><th>LAST</th><th>AVG</th><th>MAX</th><th>THRESH</th><th>TREND</th></tr>
      </thead>
      <tbody>
        {metrics.map((m) => {
          const s = seriesMap[m.id] || [];
          const last = s[s.length - 1] ?? 0;
          const avg = s.reduce((a, b) => a + b, 0) / (s.length || 1);
          const max = Math.max(...s);
          const th = thresholds[m.id];
          const breach = th != null && last > th;
          const lo = Math.min(...s), span = max - lo || 1;
          const pts = s.filter((_, i) => i % 2 === 0)
            .map((v, i) => `${i * 3},${16 - ((v - lo) / span) * 14}`).join(" ");
          return (
            <tr key={m.id}>
              <td><P type="metric" object={m.id} label={m.name} className="cell-pres">{m.name}</P></td>
              <td className={breach ? "rv" : ""}>{fmt(last)} {m.unit}</td>
              <td>{fmt(avg)}</td>
              <td>{fmt(max)}</td>
              <td>{th != null ? fmt(th) : "—"}</td>
              <td>
                <svg width="92" height="18" className="spark">
                  <polyline points={pts} fill="none" stroke="#000" strokeWidth="1.4" />
                  {th != null && (
                    <line x1="0" x2="92" y1={16 - ((th - lo) / span) * 14} y2={16 - ((th - lo) / span) * 14}
                      stroke="#000" strokeWidth="1" strokeDasharray="3 2" />
                  )}
                </svg>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ChartPane({ panel, metrics, seriesMap, thresholds }) {
  const defs = panel.metricIds.map((id) => metrics.find((m) => m.id === id)).filter(Boolean);
  const W = Math.max(60, panel.w - 82), H = Math.max(40, panel.h - 92);
  const all = defs.flatMap((d) => seriesMap[d.id] || []);
  const ths = defs.map((d) => thresholds[d.id]).filter((v) => v != null);
  let lo = Math.min(...all, ...(ths.length ? ths : [Infinity]));
  let hi = Math.max(...all, ...(ths.length ? ths : [-Infinity]));
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  const span = hi - lo || 1;
  const N = HISTORY_LEN;
  const X = (i) => (i / (N - 1)) * W;
  const Y = (v) => H - ((v - lo) / span) * (H - 8) - 4;
  const pid = `stip-${panel.id}`;

  return (
    <div className="chartwrap">
      <div className="legend">
        {defs.map((d, i) => (
          <P key={d.id} type="metric" object={d.id} label={d.name} className="legend-item">
            <span className="swatch">{i === 0 ? "──" : "···"}</span> {d.name} ({d.unit})
          </P>
        ))}
        <span className="charttype">[{panel.chartType.toUpperCase()}]</span>
      </div>
      <div className="chartbody">
        <div className="yaxis"><span>{fmt(hi)}</span><span>{fmt(lo)}</span></div>
        <svg width={W} height={H} className="chart-svg">
          <defs>
            <pattern id={pid} width="4" height="4" patternUnits="userSpaceOnUse">
              <rect width="4" height="4" fill="#fff" />
              <rect width="1.4" height="1.4" x="1" y="1" fill="#000" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={W} height={H} fill="none" stroke="#000" strokeWidth="1.5" />
          {defs.map((d, di) => {
            const s = seriesMap[d.id] || [];
            if (panel.chartType === "bars" && di === 0) {
              const bw = Math.max(2, (W / N) * 0.55);
              return (
                <g key={d.id}>
                  {s.map((v, i) => (
                    <rect key={i} x={X(i) - bw / 2} y={Y(v)} width={bw} height={Math.max(0, H - 4 - Y(v))} fill="#000" />
                  ))}
                </g>
              );
            }
            const pts = s.map((v, i) => `${X(i)},${Y(v)}`).join(" ");
            if (panel.chartType === "area" && di === 0) {
              return (
                <g key={d.id}>
                  <path d={`M0,${H - 4} L${pts.replace(/ /g, " L")} L${W},${H - 4} Z`} fill={`url(#${pid})`} stroke="none" />
                  <polyline points={pts} fill="none" stroke="#000" strokeWidth="2" />
                </g>
              );
            }
            return (
              <polyline key={d.id} points={pts} fill="none" stroke="#000"
                strokeWidth={di === 0 ? 2 : 1.6} strokeDasharray={di === 0 ? "" : "4 3"} />
            );
          })}
          {defs.map((d) => {
            const th = thresholds[d.id];
            if (th == null) return null;
            return (
              <g key={"th" + d.id}>
                <line x1="0" x2={W} y1={Y(th)} y2={Y(th)} stroke="#000" strokeWidth="1.2" strokeDasharray="6 3" />
                <text x={W - 4} y={Y(th) - 3} textAnchor="end" className="thlabel">THRESH {fmt(th)}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function QueuePane({ tasks, agents }) {
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  const order = { RUNNING: 0, QUEUED: 1, BLOCKED: 2, DRAFT: 3, FAILED: 4, ABORTED: 5, DONE: 6 };
  const sorted = [...tasks].sort((a, b) =>
    (order[a.status] - order[b.status]) || (PRIO_RANK[a.prio] - PRIO_RANK[b.prio]) || a.id.localeCompare(b.id));
  return (
    <table className="mtable qtable">
      <thead>
        <tr><th>TASK</th><th>KIND</th><th>TARGET</th><th>PRI</th><th>PLAN</th><th>AGENT</th><th>STATUS</th><th>PROGRESS</th></tr>
      </thead>
      <tbody>
        {sorted.map((t) => (
          <tr key={t.id} className={t.status === "DONE" ? "dim" : ""}>
            <td><P type="task" object={t.id} label={t.id} className="cell-pres">{t.id}</P></td>
            <td>{t.kind}</td>
            <td className="target">{t.target}</td>
            <td className={PRIO_CLASS[t.prio]}>{t.prio}</td>
            <td>{t.planId ? <P type="plan" object={t.planId} label={t.planId}>{t.planId}</P> : "—"}</td>
            <td>
              {t.agentId ? (
                <P type="agent" object={t.agentId} label={byId[t.agentId]?.name || t.agentId}>
                  {byId[t.agentId]?.name}
                </P>
              ) : t.deps.length && t.status === "BLOCKED" ? (
                <span className="deps">⊣ {t.deps.join(",")}</span>
              ) : "—"}
            </td>
            <td className={STATUS_CLASS[t.status]}>{t.status}</td>
            <td className="prog">{t.status === "DONE" ? "▓▓▓▓▓▓▓▓" : bar(t.progress)} {Math.round(t.progress)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RosterPane({ agents, tasks }) {
  const taskById = Object.fromEntries(tasks.map((t) => [t.id, t]));
  return (
    <table className="mtable">
      <thead>
        <tr><th>AGENT</th><th>TAKES</th><th>STATE</th><th>TASK</th><th>✓/✗</th></tr>
      </thead>
      <tbody>
        {agents.map((a) => {
          const state = a.paused ? "PAUSED" : a.taskId ? "BUSY" : "IDLE";
          const t = a.taskId ? taskById[a.taskId] : null;
          return (
            <tr key={a.id}>
              <td><P type="agent" object={a.id} label={a.name} className="cell-pres">{a.name}</P></td>
              <td className="takes">{a.takes.join(" ")}</td>
              <td className={STATUS_CLASS[state]}>{state}</td>
              <td>{t ? <P type="task" object={t.id} label={t.id}>{t.id}</P> : "—"}</td>
              <td>{a.done}/<span className={a.failed ? "c-coral" : ""}>{a.failed}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DispatchPane({ agents, tasks, panel }) {
  const W = 330, H = 262;
  const taskById = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const ay = (i) => 30 + i * ((H - 60) / (AGENT_DEFS.length - 1));
  return (
    <svg width={Math.max(60, panel.w - 20)} height={Math.max(60, panel.h - 46)}
      viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {agents.map((a, i) => (
        <line key={a.id} x1={58} y1={H / 2} x2={140} y2={ay(i)} stroke="#000" strokeWidth="2" />
      ))}
      {agents.map((a, i) =>
        a.taskId ? <line key={"t" + a.id} x1={172} y1={ay(i)} x2={236} y2={ay(i)} stroke="#000" strokeWidth="1.5" /> : null
      )}
      <PG type="category" object="DISPATCH" label="DISPATCH">
        <ellipse className="nodedisc" cx={34} cy={H / 2} rx={32} ry={22} />
        <text className="disctext" x={34} y={H / 2 + 4} textAnchor="middle">|C|DSPCH</text>
      </PG>
      {agents.map((a, i) => (
        <PG key={a.id} type="agent" object={a.id} label={a.name}>
          <ellipse className="nodedisc" cx={137} cy={ay(i)} rx={36} ry={15} />
          <text className="disctext small" x={137} y={ay(i) + 3.5} textAnchor="middle">{a.name}</text>
          {a.paused && <text className="pausemark" x={137} y={ay(i) - 19} textAnchor="middle">‖</text>}
          {!a.taskId && !a.paused && <text className="idlemark" x={180} y={ay(i) + 4}>idle</text>}
        </PG>
      ))}
      {agents.map((a, i) => {
        const t = a.taskId ? taskById[a.taskId] : null;
        if (!t) return null;
        return (
          <PG key={"tk" + a.id} type="task" object={t.id} label={t.id}>
            <rect className="nodebox" x={238} y={ay(i) - 10} width={84} height={20} />
            <text className="boxtext" x={244} y={ay(i) + 4}>{t.id} {Math.round(t.progress)}%</text>
          </PG>
        );
      })}
    </svg>
  );
}

/* --- plan DAG --- */

function planLayout(steps) {
  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
  const memo = {};
  const lvl = (t, seen) => {
    if (memo[t.id] != null) return memo[t.id];
    if (seen.has(t.id)) return 0; // cycle guard
    seen.add(t.id);
    const ds = t.deps.map((d) => byId[d]).filter(Boolean);
    const v = ds.length ? 1 + Math.max(...ds.map((d) => lvl(d, seen))) : 0;
    memo[t.id] = v;
    return v;
  };
  steps.forEach((s) => lvl(s, new Set()));
  const cols = {};
  steps.forEach((s) => { (cols[memo[s.id]] = cols[memo[s.id]] || []).push(s); });
  const pos = {};
  Object.entries(cols).forEach(([l, arr]) => {
    arr.sort((a, b) => a.id.localeCompare(b.id));
    arr.forEach((s, r) => { pos[s.id] = { x: 12 + l * 156, y: 12 + r * 52 }; });
  });
  const nLevels = Object.keys(cols).length;
  const maxRows = Math.max(1, ...Object.values(cols).map((a) => a.length));
  return { pos, width: 12 + nLevels * 156 + 8, height: 12 + maxRows * 52 + 8 };
}

function PlanPane({ panel, plans, tasks }) {
  const plan = plans.find((p) => p.id === panel.planId);
  if (!plan) return <div className="pad-note">(plan was garbage-collected)</div>;
  const steps = tasks.filter((t) => t.planId === plan.id);
  const counts = {};
  steps.forEach((s) => (counts[s.status] = (counts[s.status] || 0) + 1));
  const { pos, width, height } = planLayout(steps);
  const NW = 132, NH = 34;
  return (
    <div className="planwrap">
      <div className="planhead">
        <P type="plan" object={plan.id} label={plan.name} className="cell-pres">{plan.name}</P>
        <span className="plancounts">
          {Object.entries(counts).map(([st, n]) => (
            <span key={st} className={STATUS_CLASS[st]}>&nbsp;{n} {st.toLowerCase()}</span>
          ))}
        </span>
      </div>
      {steps.length === 0 ? (
        <div className="pad-note">empty plan — right-click the plan name → Add Step…</div>
      ) : (
        <svg width={width} height={height}>
          {steps.map((t) =>
            t.deps.filter((d) => pos[d]).map((d) => (
              <line key={t.id + d} x1={pos[d].x + NW} y1={pos[d].y + NH / 2}
                x2={pos[t.id].x} y2={pos[t.id].y + NH / 2} stroke="#000" strokeWidth="1.6" />
            ))
          )}
          {steps.map((t) => {
            const p = pos[t.id];
            return (
              <PG key={t.id} type="task" object={t.id} label={t.id}>
                <rect className="nodebox" x={p.x} y={p.y} width={NW} height={NH}
                  strokeDasharray={t.status === "DRAFT" ? "4 3" : ""} />
                <text className="boxtext" x={p.x + 7} y={p.y + 14}>
                  {t.id} <tspan className={"g-" + (STATUS_CLASS[t.status] || "ink")}>{STATUS_GLYPH[t.status] || ""}</tspan>
                  {t.status === "RUNNING" ? <tspan className="g-c-teal"> {Math.round(t.progress)}%</tspan> : null}
                </text>
                <text className="boxtext sub" x={p.x + 7} y={p.y + 27}>{t.kind}</text>
              </PG>
            );
          })}
        </svg>
      )}
      <div className="pad-hint">edit: right-click a step → Link/Unlink/Remove · plan name → Add Step / Run Plan</div>
    </div>
  );
}

/* --- events --- */

function eventVisible(ev, f) {
  const entityOk =
    (!f.taskIds?.length && !f.agents?.length) ||
    (ev.taskId && f.taskIds?.includes(ev.taskId)) ||
    (ev.agent && f.agents?.includes(ev.agent));
  const kindOk = !f.kind || f.kind === "ALL" || ev.kind === f.kind.toLowerCase();
  return entityOk && kindOk;
}

function EventsPane({ panel, events, agents }) {
  const f = panel.filters || {};
  const nameById = Object.fromEntries(agents.map((a) => [a.name, a.id]));
  const rows = events.filter((e) => eventVisible(e, f)).slice(-80);
  return (
    <div className="evwrap">
      <div className="evfilter">
        WATCH:&nbsp;
        {(f.taskIds || []).map((id) => (
          <P key={id} type="task" object={id} label={id} className="chip">{id}</P>
        ))}
        {(f.agents || []).map((n) => (
          <P key={n} type="agent" object={nameById[n] || n} label={n} className="chip">{n}</P>
        ))}
        {!(f.taskIds?.length || f.agents?.length) && <span className="dimtext">everything</span>}
        <span className="spacer" />
        KIND: <span className={f.kind && f.kind !== "ALL" ? "c-gold" : ""}>{f.kind || "ALL"}</span>
      </div>
      <table className="mtable evtable">
        <tbody>
          {rows.length === 0 && (
            <tr><td className="dimtext">no events match this filter — right-click the window title → Watch Task… / Filter Kind…</td></tr>
          )}
          {rows.map((e, i) => (
            <tr key={i}>
              <td className="evtime">{e.t}</td>
              <td>{nameById[e.agent]
                ? <P type="agent" object={nameById[e.agent]} label={e.agent}>{e.agent}</P>
                : e.agent}</td>
              <td>{e.taskId ? <P type="task" object={e.taskId} label={e.taskId}>{e.taskId}</P> : "—"}</td>
              <td className={KIND_CLASS[e.kind?.toUpperCase()] || ""}>{e.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --- results --- */

function ResultPane({ panel, tasks }) {
  const t = tasks.find((x) => x.id === panel.taskId);
  if (!t) return <div className="pad-note">(task was garbage-collected — result no longer available)</div>;
  if (!t.result) return <div className="pad-note">{t.id} has no result yet (status {t.status}).</div>;
  return (
    <div className="reswrap">
      <div className="reshead">
        <P type="task" object={t.id} label={t.id} className="cell-pres">{t.id}</P>
        &nbsp;{t.kind} → <span className="target">{t.target}</span>
        {t.planId && <> · plan <P type="plan" object={t.planId} label={t.planId}>{t.planId}</P></>}
      </div>
      <table className="mtable kvtable">
        <tbody>
          {Object.entries(t.result.kv).map(([k, v]) => (
            <tr key={k}><td className="kvkey">{k.toUpperCase()}</td><td>{String(v)}</td></tr>
          ))}
        </tbody>
      </table>
      {t.result.rows.length > 0 && (
        <div className="resrows">
          {t.result.rows.map((r, i) => <div key={i}>│ {r}</div>)}
        </div>
      )}
    </div>
  );
}

/* --------------------------- window ------------------------------ */

function Win({ panel, onDrag, onResize, onRaise, children }) {
  const startDrag = (e, mode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onRaise(panel.id);
    const s = { sx: e.clientX, sy: e.clientY, ox: panel.x, oy: panel.y, ow: panel.w, oh: panel.h };
    const move = (ev) => {
      const dx = ev.clientX - s.sx, dy = ev.clientY - s.sy;
      if (mode === "move") onDrag(panel.id, Math.max(0, s.ox + dx), Math.max(0, s.oy + dy));
      else onResize(panel.id, Math.max(220, s.ow + dx), Math.max(130, s.oh + dy));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return (
    <div className="win" style={{ left: panel.x, top: panel.y, width: panel.w, height: panel.h }}
      onMouseDown={() => onRaise(panel.id)}>
      <div className="win-title" onMouseDown={(e) => startDrag(e, "move")}>
        <P type="panel" object={panel.id} label={panel.title} className="win-title-pres">{panel.title}</P>
        <span className="win-deco">▚▚</span>
      </div>
      <div className="win-body">{children}</div>
      <div className="win-resize" onMouseDown={(e) => startDrag(e, "resize")}>◢</div>
    </div>
  );
}

/* ---------------------------- menu ------------------------------- */

function Menu({ menu, onClose }) {
  if (!menu) return null;
  const x = Math.min(menu.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 240);
  const y = Math.min(menu.y, (typeof window !== "undefined" ? window.innerHeight : 800) - menu.items.length * 22 - 90);
  return (
    <div className="menu" style={{ left: x, top: Math.max(4, y) }}
      onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <div className="menu-title">{menu.title}</div>
      {menu.items.map((it, i) =>
        it.divider ? (
          <div key={i} className="menu-div" />
        ) : (
          <div key={i} className="menu-item" onClick={(e) => { e.stopPropagation(); onClose(); it.action(); }}>
            {it.label}
          </div>
        )
      )}
      <div className="menu-item menu-abort" onClick={(e) => { e.stopPropagation(); onClose(); }}>Abort ×</div>
    </div>
  );
}

/* ----------------------------- app ------------------------------- */

let PANEL_SEQ = 10;
let TASK_SEQ = 120;
let PLAN_SEQ = 2;

export default function PresentationMetrics() {
  const [seriesMap, setSeriesMap] = useState(() =>
    Object.fromEntries(METRIC_DEFS.map((d) => [d.id, genSeries(d)]))
  );
  const [thresholds, setThresholds] = useState({ lat: 110, qd: 8 });
  const [paused, setPaused] = useState(false);
  const [agents, setAgents] = useState(initialAgents);
  const [tasks, setTasks] = useState(initialTasks);
  const [plans, setPlans] = useState(initialPlans);
  const [events, setEvents] = useState([
    { t: hhmmss(), agent: "DISPATCH", taskId: null, kind: "info", text: "dispatcher online, 5 agents registered" },
  ]);
  const [panels, setPanels] = useState(() => [
    { id: "p-tree",   kind: "tree",     title: "CONCEPT-GRAPH",    x: 12,   y: 10,  w: 404, h: 330 },
    { id: "p-table",  kind: "table",    title: "METRIC-TABLE",     x: 430,  y: 10,  w: 470, h: 300 },
    { id: "p-roster", kind: "roster",   title: "AGENT-ROSTER",     x: 914,  y: 10,  w: 372, h: 200 },
    { id: "p-events", kind: "events",   title: "EVENT-LOG",        x: 914,  y: 222, w: 372, h: 250, filters: {} },
    { id: "p-queue",  kind: "queue",    title: "TASK-QUEUE",       x: 12,   y: 372, w: 640, h: 316 },
    { id: "p-plan1",  kind: "plan",     title: "PLAN: SURFLINE-PIPELINE", x: 430, y: 316, w: 500, h: 200, planId: "pl-1" },
    { id: "p-disp",   kind: "dispatch", title: "DISPATCH-GRAPH",   x: 668,  y: 528, w: 350, h: 240 },
    { id: "p-c1",     kind: "chart",    title: "PLOT: THROUGHPUT", x: 1030, y: 484, w: 400, h: 240, metricIds: ["tp"], chartType: "area" },
  ]);
  const [history, setHistory] = useState([
    { kind: "out", text: "Presentation-Metrics 3.0 — right-click any object for its operations; drag ◢ to resize windows." },
    { kind: "out", text: "Plans are DAGs: right-click a plan name → Add Step… / Run Plan; steps → Link Steps… to add edges." },
    { kind: "out", text: "Right-click a task → Open Events / Show Result. Esc aborts an argument prompt." },
  ]);
  const [menu, setMenu] = useState(null);
  const [accepting, setAccepting] = useState(null);
  const [hoverPres, setHoverPres] = useState(null);
  const [clock, setClock] = useState(new Date());
  const [inputVal, setInputVal] = useState("");

  const pointer = useRef({ x: 300, y: 300 });
  const acceptingRef = useRef(null); acceptingRef.current = accepting;
  const pausedRef = useRef(paused);  pausedRef.current = paused;
  const tasksRef = useRef(tasks);    tasksRef.current = tasks;
  const agentsRef = useRef(agents);  agentsRef.current = agents;
  const plansRef = useRef(plans);    plansRef.current = plans;
  const doneTimesRef = useRef([Date.now() - 20000, Date.now() - 45000]);
  const histRef = useRef(null);
  const inputRef = useRef(null);

  const print = useCallback((text, kind = "out") =>
    setHistory((h) => [...h.slice(-300), { kind, text }]), []);

  const logEv = useCallback((agent, text, taskId = null, kind = "info") =>
    setEvents((es) => [...es.slice(-260), { t: hhmmss(), agent, text, taskId, kind }]), []);

  /* ------------------- simulation tick ------------------- */
  useEffect(() => {
    const t = setInterval(() => {
      if (pausedRef.current) return;
      const now = Date.now();
      const nextTasks = tasksRef.current.map((x) => ({ ...x, deps: [...x.deps] }));
      const nextAgents = agentsRef.current.map((x) => ({ ...x }));
      const byId = Object.fromEntries(nextTasks.map((x) => [x.id, x]));

      for (const tk of nextTasks) {
        if (tk.status === "BLOCKED" && tk.deps.every((d) => byId[d]?.status === "DONE")) {
          tk.status = "QUEUED";
          logEv("DISPATCH", `${tk.id} unblocked (deps satisfied)`, tk.id, "assign");
        }
      }
      for (const a of nextAgents) {
        if (!a.taskId || a.paused) continue;
        const tk = byId[a.taskId];
        if (!tk || tk.status !== "RUNNING") { a.taskId = null; continue; }
        if (Math.random() < 0.025) {
          tk.status = "FAILED"; tk.agentId = null;
          a.taskId = null; a.failed++;
          logEv(a.name, `${tk.id} FAILED on ${tk.target}`, tk.id, "fail");
          print(`;; ${a.name}: task ${tk.id} (${tk.kind} ${tk.target}) FAILED`, "err");
          continue;
        }
        tk.progress = Math.min(100, tk.progress + 7 + Math.random() * 16);
        if (tk.progress >= 100) {
          tk.status = "DONE"; tk.agentId = null;
          tk.result = makeResult(tk);
          a.taskId = null; a.done++;
          doneTimesRef.current.push(now);
          logEv(a.name, `${tk.id} completed (${tk.kind} ${tk.target})`, tk.id, "done");
        }
      }
      const queued = nextTasks
        .filter((x) => x.status === "QUEUED")
        .sort((p, q) => PRIO_RANK[p.prio] - PRIO_RANK[q.prio] || p.id.localeCompare(q.id));
      for (const a of nextAgents) {
        if (a.taskId || a.paused) continue;
        const pick = queued.find((x) => x.status === "QUEUED" && a.takes.includes(x.kind));
        if (pick) {
          pick.status = "RUNNING"; pick.agentId = a.id; a.taskId = pick.id;
          logEv("DISPATCH", `${pick.id} → ${a.name}`, pick.id, "assign");
        }
      }
      // spawn a new pipeline plan now and then
      let nextPlans = plansRef.current;
      const active = nextTasks.filter((x) => ["QUEUED", "RUNNING", "BLOCKED"].includes(x.status)).length;
      if (Math.random() < 0.14 && active < 11) {
        const target = TARGET_POOL[Math.floor(Math.random() * TARGET_POOL.length)];
        const plId = "pl-" + PLAN_SEQ++;
        nextPlans = [...nextPlans, { id: plId, name: target.split("/")[0].toUpperCase() + "-PIPELINE" }];
        const s = { id: "T-" + TASK_SEQ++, kind: Math.random() < 0.75 ? "SCRAPE" : "CRAWL", target, prio: "NORMAL", status: "QUEUED", agentId: null, progress: 0, deps: [], planId: plId };
        const p = { id: "T-" + TASK_SEQ++, kind: "PARSE", target, prio: "NORMAL", status: "BLOCKED", agentId: null, progress: 0, deps: [s.id], planId: plId };
        nextTasks.push(s, p);
        if (Math.random() < 0.5)
          nextTasks.push({ id: "T-" + TASK_SEQ++, kind: "INDEX", target, prio: "LOW", status: "BLOCKED", agentId: null, progress: 0, deps: [p.id], planId: plId });
        logEv("DISPATCH", `new plan ${plId} for ${target} (${s.id}…)`, s.id, "spawn");
      }
      // garbage-collect old DONE tasks (keep plans intact while any step is live)
      const livePlan = new Set(nextTasks.filter((x) => x.status !== "DONE" && x.planId).map((x) => x.planId));
      const done = nextTasks.filter((x) => x.status === "DONE" && !livePlan.has(x.planId));
      let trimmed = nextTasks;
      if (done.length > 8) {
        const drop = new Set(done.slice(0, done.length - 8).map((x) => x.id));
        for (const x of nextTasks) if (x.status !== "DONE") x.deps.forEach((d) => drop.delete(d));
        trimmed = nextTasks.filter((x) => !drop.has(x.id));
      }
      const usedPlans = new Set(trimmed.map((x) => x.planId).filter(Boolean));
      nextPlans = nextPlans.filter((p) => usedPlans.has(p.id));

      doneTimesRef.current = doneTimesRef.current.filter((ts) => now - ts < 60000);
      const qDepth = trimmed.filter((x) => x.status === "QUEUED" || x.status === "BLOCKED").length;
      const thr = doneTimesRef.current.length;
      setSeriesMap((prev) => {
        const next = {};
        for (const d of METRIC_DEFS) {
          const s = prev[d.id];
          const v = d.id === "qd" ? qDepth : d.id === "tp" ? thr : nextPoint(d, s[s.length - 1]);
          next[d.id] = [...s.slice(1), v];
        }
        return next;
      });
      setTasks(trimmed);
      setAgents(nextAgents);
      setPlans(nextPlans);
    }, 900);
    const c = setInterval(() => setClock(new Date()), 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [print, logEv]);

  useEffect(() => {
    if (histRef.current) histRef.current.scrollTop = histRef.current.scrollHeight;
  }, [history, accepting]);
  useEffect(() => {
    if (accepting?.spec?.kind === "input" && inputRef.current) inputRef.current.focus();
  }, [accepting]);

  /* ------- lookups ------- */
  const metricByRef = (id) => METRIC_DEFS.find((m) => m.id === id);
  const panelById = (id) => panels.find((p) => p.id === id);
  const taskByRef = (id) => tasksRef.current.find((t) => t.id === id);
  const agentByRef = (id) => agentsRef.current.find((a) => a.id === id);
  const planByRef = (id) => plansRef.current.find((p) => p.id === id);

  /* ------- panel ops ------- */
  const spawnPanel = (extra) => {
    const id = "p-" + PANEL_SEQ++;
    setPanels((ps) => [...ps, {
      id, x: 90 + (PANEL_SEQ % 6) * 34, y: 80 + (PANEL_SEQ % 6) * 30, ...extra,
    }]);
    return id;
  };
  const addChart = (metricIds, chartType, title) =>
    spawnPanel({ kind: "chart", title, chartType, metricIds, w: 430, h: 250 });
  const raise = (id) => setPanels((ps) => {
    const p = ps.find((q) => q.id === id);
    return p ? [...ps.filter((q) => q.id !== id), p] : ps;
  });
  const bury = (id) => setPanels((ps) => {
    const p = ps.find((q) => q.id === id);
    return p ? [p, ...ps.filter((q) => q.id !== id)] : ps;
  });
  /** open-or-expose a window identified by a predicate */
  const openOrExpose = (pred, make) => {
    const existing = panels.find(pred);
    if (existing) { raise(existing.id); return existing.id; }
    return spawnPanel(make());
  };

  const openPlanWindow = (planId) => {
    const pl = planByRef(planId);
    if (!pl) return print("  ?? no such plan", "err");
    openOrExpose(
      (p) => p.kind === "plan" && p.planId === planId,
      () => ({ kind: "plan", title: "PLAN: " + pl.name, planId, w: 520, h: 240 })
    );
    print(`  → plan window PLAN: ${pl.name}`);
  };
  const openResultWindow = (taskId) => {
    openOrExpose(
      (p) => p.kind === "result" && p.taskId === taskId,
      () => ({ kind: "result", title: "RESULT: " + taskId, taskId, w: 380, h: 260 })
    );
    print(`  → result window for ${taskId}`);
  };
  const openEventsWindow = (filters, title) => {
    spawnPanel({ kind: "events", title, filters, w: 400, h: 240 });
    print(`  → events window ${title}`);
  };

  /* ------- describe ------- */
  const describe = (pres) => {
    print(`Describe ${pres.label}`, "echo");
    if (pres.type === "metric") {
      const m = metricByRef(pres.object); const s = seriesMap[m.id];
      const last = s[s.length - 1], avg = s.reduce((a, b) => a + b, 0) / s.length;
      print(`  ${m.name} is a METRIC in category ${m.cat}, unit ${m.unit}${m.derived ? " (derived from TASK-DISPATCH)" : ""}.`);
      print(`  ${s.length} samples · last ${fmt(last)} · avg ${fmt(avg)} · min ${fmt(Math.min(...s))} · max ${fmt(Math.max(...s))}` +
        (thresholds[m.id] != null ? ` · threshold ${fmt(thresholds[m.id])}` : ""));
    } else if (pres.type === "task") {
      const t = taskByRef(pres.object);
      if (!t) return print("  (task no longer exists)");
      const ag = t.agentId ? agentByRef(t.agentId)?.name : null;
      print(`  ${t.id} is a TASK: ${t.kind} on ${t.target}, priority ${t.prio}${t.planId ? `, step of ${t.planId}` : ""}.`);
      print(`  status ${t.status} · progress ${Math.round(t.progress)}%` +
        (ag ? ` · assigned to ${ag}` : "") +
        (t.deps.length ? ` · depends on ${t.deps.join(", ")}` : "") +
        (t.result ? " · has RESULT (Show Result)" : ""));
    } else if (pres.type === "agent") {
      const a = agentByRef(pres.object);
      const t = a.taskId ? taskByRef(a.taskId) : null;
      print(`  ${a.name} is an AGENT accepting [${a.takes.join(" ")}].`);
      print(`  state ${a.paused ? "PAUSED" : a.taskId ? "BUSY" : "IDLE"}` +
        (t ? ` on ${t.id} (${t.kind} ${t.target})` : "") +
        ` · ${a.done} completed · ${a.failed} failed`);
    } else if (pres.type === "plan") {
      const pl = planByRef(pres.object);
      if (!pl) return print("  (plan no longer exists)");
      const steps = tasksRef.current.filter((t) => t.planId === pl.id);
      print(`  ${pl.name} (${pl.id}) is a PLAN with ${steps.length} steps:`);
      print(`  ${steps.map((s) => `${s.id}:${s.status}`).join("  ") || "(none)"}`);
    } else if (pres.type === "category") {
      if (pres.object === "DISPATCH") {
        const q = tasksRef.current.filter((t) => t.status === "QUEUED").length;
        print(`  DISPATCH is the cooperation scheduler: ${q} queued, ${agentsRef.current.filter((a) => a.taskId).length} agents busy.`);
      } else {
        const kids = pres.object === "METRICS" ? CATS : METRIC_DEFS.filter((m) => m.cat === pres.object).map((m) => m.name);
        print(`  ${pres.label} is a CATEGORY with children: ${kids.join(", ")}.`);
      }
    } else if (pres.type === "panel") {
      const p = panelById(pres.object);
      if (p) print(`  ${p.title} is a ${p.kind.toUpperCase()} window at (${p.x},${p.y}), ${p.w}×${p.h}` +
        (p.metricIds ? `, showing ${p.metricIds.map((i) => metricByRef(i).name).join(" + ")} as ${p.chartType}` : "") + ".");
    } else print(`  ${pres.label} — no further information.`);
  };

  /* ------- dependency cycle check: is `a` reachable from `b` via deps? ------- */
  const dependsOn = (bId, aId) => {
    const seen = new Set();
    const walk = (id) => {
      if (id === aId) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      const t = taskByRef(id);
      return t ? t.deps.some(walk) : false;
    };
    return walk(bId);
  };

  /* ------- commands ------- */
  const COMMANDS = [
    { name: "Describe", args: [{ type: "any", prompt: "an object" }],
      appliesTo: () => true,
      run: (_, presArgs) => describe(presArgs[0]) },

    /* --- metrics --- */
    { name: "Plot Metric", args: [{ type: "metric", prompt: "a metric" }], dflt: "metric",
      appliesTo: (p) => p.type === "metric",
      run: ([id]) => { const m = metricByRef(id); addChart([id], "line", "PLOT: " + m.name); print(`  → new chart window PLOT: ${m.name}`); } },
    { name: "Compare Metrics",
      args: [{ type: "metric", prompt: "first metric" }, { type: "metric", prompt: "second metric" }],
      appliesTo: (p) => p.type === "metric",
      run: ([a, b]) => {
        const ma = metricByRef(a), mb = metricByRef(b);
        addChart([a, b], "line", `CMP: ${ma.name} / ${mb.name}`);
        print(`  → comparison chart ${ma.name} (solid) vs ${mb.name} (dashed)`);
      } },
    { name: "Set Threshold",
      args: [{ type: "metric", prompt: "a metric" }, { type: "number", kind: "input", prompt: "threshold value" }],
      appliesTo: (p) => p.type === "metric",
      run: ([id, v]) => { setThresholds((t) => ({ ...t, [id]: v })); print(`  → threshold of ${metricByRef(id).name} set to ${fmt(v)}`); } },
    { name: "Clear Threshold", args: [{ type: "metric", prompt: "a metric" }],
      appliesTo: (p) => p.type === "metric" && thresholds[p.object] != null,
      run: ([id]) => { setThresholds((t) => { const n = { ...t }; delete n[id]; return n; }); print(`  → threshold cleared on ${metricByRef(id).name}`); } },
    { name: "Hardcopy", args: [{ type: "metric", prompt: "a metric" }],
      appliesTo: (p) => p.type === "metric",
      run: ([id]) => {
        const m = metricByRef(id); const s = seriesMap[id];
        const lo = Math.min(...s), span = Math.max(...s) - lo || 1;
        print(`  ${m.name} [${fmt(lo)}..${fmt(lo + span)} ${m.unit}]`);
        print("  " + s.map((v) => SPARK[Math.min(7, Math.floor(((v - lo) / span) * 8))]).join(""));
      } },

    /* --- task results & events (defaults first: order matters for L-click) --- */
    { name: "Show Result", args: [{ type: "task", prompt: "a finished task" }], dflt: "task",
      appliesTo: (p) => p.type === "task" && !!taskByRef(p.object)?.result,
      run: ([tid]) => openResultWindow(tid) },
    { name: "Show Plan", args: [{ type: "task", prompt: "a plan step" }], dflt: "task",
      appliesTo: (p) => p.type === "task" && !!taskByRef(p.object)?.planId,
      run: ([tid]) => openPlanWindow(taskByRef(tid).planId) },
    { name: "Open Events", args: [{ type: "task", prompt: "a task" }],
      appliesTo: (p) => p.type === "task",
      run: ([tid]) => openEventsWindow({ taskIds: [tid] }, "EVENTS: " + tid) },
    { name: "Open Agent Events", args: [{ type: "agent", prompt: "an agent" }],
      appliesTo: (p) => p.type === "agent",
      run: ([aid]) => { const a = agentByRef(aid); openEventsWindow({ agents: [a.name] }, "EVENTS: " + a.name); } },

    /* --- events window editing --- */
    { name: "Watch Task",
      args: [{ type: "events", prompt: "an events window" }, { type: "task", prompt: "a task to watch" }],
      appliesTo: (p) => p.type === "panel" && panelById(p.object)?.kind === "events",
      coerceFirst: (p) => ({ ...p, type: "events" }),
      run: ([pid, tid]) => {
        setPanels((ps) => ps.map((p) => p.id === pid
          ? { ...p, filters: { ...p.filters, taskIds: [...new Set([...(p.filters?.taskIds || []), tid])] } }
          : p));
        print(`  → now watching ${tid}`);
      } },
    { name: "Watch Agent",
      args: [{ type: "events", prompt: "an events window" }, { type: "agent", prompt: "an agent to watch" }],
      appliesTo: (p) => p.type === "panel" && panelById(p.object)?.kind === "events",
      coerceFirst: (p) => ({ ...p, type: "events" }),
      run: ([pid, aid]) => {
        const a = agentByRef(aid);
        setPanels((ps) => ps.map((p) => p.id === pid
          ? { ...p, filters: { ...p.filters, agents: [...new Set([...(p.filters?.agents || []), a.name])] } }
          : p));
        print(`  → now watching ${a.name}`);
      } },
    { name: "Filter Kind",
      args: [{ type: "events", prompt: "an events window" },
             { type: "event-kind", kind: "menu", prompt: "event kind", options: EVENT_KINDS }],
      appliesTo: (p) => p.type === "panel" && panelById(p.object)?.kind === "events",
      coerceFirst: (p) => ({ ...p, type: "events" }),
      run: ([pid, kind]) => {
        setPanels((ps) => ps.map((p) => p.id === pid ? { ...p, filters: { ...p.filters, kind } } : p));
        print(`  → event kind filter: ${kind}`);
      } },
    { name: "Clear Watch", args: [{ type: "events", prompt: "an events window" }],
      appliesTo: (p) => p.type === "panel" && panelById(p.object)?.kind === "events" &&
        (panelById(p.object)?.filters?.taskIds?.length || panelById(p.object)?.filters?.agents?.length || panelById(p.object)?.filters?.kind),
      coerceFirst: (p) => ({ ...p, type: "events" }),
      run: ([pid]) => {
        setPanels((ps) => ps.map((p) => p.id === pid ? { ...p, filters: {} } : p));
        print(`  → filter cleared (showing everything)`);
      } },

    /* --- tasks --- */
    { name: "Assign Task",
      args: [{ type: "task", prompt: "a task" }, { type: "agent", prompt: "an agent" }],
      appliesTo: (p) => p.type === "task" && ["QUEUED", "BLOCKED", "FAILED", "ABORTED", "DRAFT"].includes(taskByRef(p.object)?.status),
      run: ([tid, aid]) => {
        const t = taskByRef(tid), a = agentByRef(aid);
        if (!t || !a) return print("  ?? object vanished");
        if (!a.takes.includes(t.kind)) return print(`  ?? ${a.name} does not accept ${t.kind} tasks (takes ${a.takes.join(" ")})`, "err");
        if (a.taskId) return print(`  ?? ${a.name} is BUSY on ${a.taskId}`, "err");
        if (a.paused) return print(`  ?? ${a.name} is PAUSED`, "err");
        const unmet = t.deps.filter((d) => taskByRef(d)?.status !== "DONE");
        if (unmet.length) print(`  ;; forcing ${t.id} despite unmet deps: ${unmet.join(", ")}`, "err");
        setTasks((ts) => ts.map((x) => x.id === tid
          ? { ...x, status: "RUNNING", agentId: aid, progress: ["FAILED", "ABORTED"].includes(x.status) ? 0 : x.progress }
          : x));
        setAgents((as) => as.map((x) => x.id === aid ? { ...x, taskId: tid } : x));
        logEv("USER", `${t.id} manually assigned → ${a.name}`, tid, "user");
        print(`  → ${t.id} assigned to ${a.name}`);
      } },
    { name: "Set Priority",
      args: [{ type: "task", prompt: "a task" },
             { type: "priority", kind: "menu", prompt: "priority", options: PRIOS }],
      appliesTo: (p) => p.type === "task" && taskByRef(p.object)?.status !== "DONE",
      run: ([tid, prio]) => { setTasks((ts) => ts.map((x) => x.id === tid ? { ...x, prio } : x)); print(`  → ${tid} priority set to ${prio}`); } },
    { name: "Retry Task", args: [{ type: "task", prompt: "a task" }],
      appliesTo: (p) => p.type === "task" && ["FAILED", "ABORTED"].includes(taskByRef(p.object)?.status),
      run: ([tid]) => { setTasks((ts) => ts.map((x) => x.id === tid ? { ...x, status: "QUEUED", progress: 0, agentId: null } : x)); print(`  → ${tid} re-queued`); } },
    { name: "Abort Task", args: [{ type: "task", prompt: "a task" }],
      appliesTo: (p) => p.type === "task" && ["QUEUED", "RUNNING", "BLOCKED"].includes(taskByRef(p.object)?.status),
      run: ([tid]) => {
        const t = taskByRef(tid);
        if (t?.agentId) setAgents((as) => as.map((x) => x.id === t.agentId ? { ...x, taskId: null } : x));
        setTasks((ts) => ts.map((x) => x.id === tid ? { ...x, status: "ABORTED", agentId: null } : x));
        logEv("USER", `${tid} aborted`, tid, "user");
        print(`  → ${tid} aborted`);
      } },
    { name: "New Task",
      args: [
        { type: "task-kind", kind: "menu", prompt: "task kind", options: TASK_KINDS },
        { type: "string", kind: "input", prompt: "target (url, metric…)" },
        { type: "priority", kind: "menu", prompt: "priority", options: PRIOS },
      ],
      appliesTo: () => false,
      run: ([kind, target, prio]) => {
        const id = "T-" + TASK_SEQ++;
        setTasks((ts) => [...ts, { id, kind, target: String(target), prio, status: "QUEUED", agentId: null, progress: 0, deps: [], planId: null }]);
        logEv("USER", `${id} created (${kind} ${target})`, id, "user");
        print(`  → ${id} queued: ${kind} ${target} [${prio}]`);
      } },

    /* --- plan editing --- */
    { name: "Show Plan Window", args: [{ type: "plan", prompt: "a plan" }], dflt: "plan",
      appliesTo: (p) => p.type === "plan",
      run: ([plId]) => openPlanWindow(plId) },
    { name: "Run Plan", args: [{ type: "plan", prompt: "a plan" }],
      appliesTo: (p) => p.type === "plan" &&
        tasksRef.current.some((t) => t.planId === p.object && t.status === "DRAFT"),
      run: ([plId]) => {
        setTasks((ts) => {
          const byId = Object.fromEntries(ts.map((x) => [x.id, x]));
          return ts.map((x) => x.planId === plId && x.status === "DRAFT"
            ? { ...x, status: x.deps.every((d) => byId[d]?.status === "DONE") ? "QUEUED" : "BLOCKED" }
            : x);
        });
        logEv("USER", `plan ${plId} released to dispatcher`, null, "user");
        print(`  → plan ${plId} running (draft steps released)`);
      } },
    { name: "Abort Plan", args: [{ type: "plan", prompt: "a plan" }],
      appliesTo: (p) => p.type === "plan" &&
        tasksRef.current.some((t) => t.planId === p.object && ["QUEUED", "RUNNING", "BLOCKED"].includes(t.status)),
      run: ([plId]) => {
        const victims = tasksRef.current.filter((t) => t.planId === plId && ["QUEUED", "RUNNING", "BLOCKED"].includes(t.status));
        const agentIds = victims.map((v) => v.agentId).filter(Boolean);
        setAgents((as) => as.map((x) => agentIds.includes(x.id) ? { ...x, taskId: null } : x));
        setTasks((ts) => ts.map((x) => x.planId === plId && ["QUEUED", "RUNNING", "BLOCKED"].includes(x.status)
          ? { ...x, status: "ABORTED", agentId: null } : x));
        logEv("USER", `plan ${plId} aborted (${victims.length} steps)`, null, "user");
        print(`  → plan ${plId} aborted`);
      } },
    { name: "Add Step",
      args: [
        { type: "plan", prompt: "a plan" },
        { type: "task-kind", kind: "menu", prompt: "step kind", options: TASK_KINDS },
        { type: "string", kind: "input", prompt: "target" },
      ],
      appliesTo: (p) => p.type === "plan",
      run: ([plId, kind, target]) => {
        const id = "T-" + TASK_SEQ++;
        setTasks((ts) => [...ts, { id, kind, target: String(target), prio: "NORMAL", status: "DRAFT", agentId: null, progress: 0, deps: [], planId: plId }]);
        openPlanWindow(plId);
        print(`  → ${id} added to ${plId} as DRAFT — use Link Steps… to add dependencies, Run Plan to release`);
      } },
    { name: "Link Steps",
      args: [{ type: "task", prompt: "upstream step (runs first)" }, { type: "task", prompt: "downstream step (depends on it)" }],
      appliesTo: (p) => p.type === "task",
      run: ([aId, bId]) => {
        if (aId === bId) return print("  ?? a step cannot depend on itself", "err");
        const b = taskByRef(bId);
        if (b.deps.includes(aId)) return print(`  ;; ${bId} already depends on ${aId}`);
        if (dependsOn(aId, bId)) return print(`  ?? refused: ${aId} already depends on ${bId} — that edge would make a cycle`, "err");
        setTasks((ts) => ts.map((x) => {
          if (x.id !== bId) return x;
          const status = x.status === "QUEUED" && taskByRef(aId)?.status !== "DONE" ? "BLOCKED" : x.status;
          return { ...x, deps: [...x.deps, aId], status };
        }));
        print(`  → ${bId} now depends on ${aId}`);
      } },
    { name: "Unlink Steps",
      args: [{ type: "task", prompt: "upstream step" }, { type: "task", prompt: "downstream step" }],
      appliesTo: (p) => p.type === "task" &&
        tasksRef.current.some((t) => t.deps.includes(p.object) || taskByRef(p.object)?.deps.length),
      run: ([aId, bId]) => {
        const b = taskByRef(bId);
        if (!b?.deps.includes(aId)) return print(`  ?? ${bId} does not depend on ${aId}`, "err");
        setTasks((ts) => ts.map((x) => {
          if (x.id !== bId) return x;
          const deps = x.deps.filter((d) => d !== aId);
          const byId = Object.fromEntries(ts.map((y) => [y.id, y]));
          const status = x.status === "BLOCKED" && deps.every((d) => byId[d]?.status === "DONE") ? "QUEUED" : x.status;
          return { ...x, deps, status };
        }));
        print(`  → ${bId} no longer depends on ${aId}`);
      } },
    { name: "Remove Step", args: [{ type: "task", prompt: "a plan step" }],
      appliesTo: (p) => p.type === "task" && !!taskByRef(p.object)?.planId &&
        ["DRAFT", "QUEUED", "BLOCKED", "FAILED", "ABORTED"].includes(taskByRef(p.object)?.status),
      run: ([tid]) => {
        setTasks((ts) => ts.filter((x) => x.id !== tid).map((x) => ({ ...x, deps: x.deps.filter((d) => d !== tid) })));
        print(`  → ${tid} removed from its plan`);
      } },
    { name: "New Plan", args: [{ type: "string", kind: "input", prompt: "plan name" }],
      appliesTo: () => false,
      run: ([name]) => {
        const id = "pl-" + PLAN_SEQ++;
        const nm = String(name).toUpperCase().replace(/\s+/g, "-");
        setPlans((ps) => [...ps, { id, name: nm }]);
        spawnPanel({ kind: "plan", title: "PLAN: " + nm, planId: id, w: 520, h: 220 });
        print(`  → plan ${id} (${nm}) created — right-click its name to Add Step…`);
      } },

    /* --- agents --- */
    { name: "Pause Agent", args: [{ type: "agent", prompt: "an agent" }],
      appliesTo: (p) => p.type === "agent" && !agentByRef(p.object)?.paused,
      run: ([aid]) => { setAgents((as) => as.map((x) => x.id === aid ? { ...x, paused: true } : x)); print(`  → ${agentByRef(aid).name} paused`); } },
    { name: "Resume Agent", args: [{ type: "agent", prompt: "an agent" }],
      appliesTo: (p) => p.type === "agent" && agentByRef(p.object)?.paused,
      run: ([aid]) => { setAgents((as) => as.map((x) => x.id === aid ? { ...x, paused: false } : x)); print(`  → ${agentByRef(aid).name} resumed`); } },
    { name: "Show Log", args: [{ type: "agent", prompt: "an agent" }], dflt: "agent",
      appliesTo: (p) => p.type === "agent",
      run: ([aid]) => {
        const a = agentByRef(aid);
        const lines = events.filter((e) => e.agent === a.name || e.text.includes(a.name)).slice(-6);
        if (!lines.length) print("  (no recorded events)");
        lines.forEach((e) => print(`  [${e.t}] ${e.agent}: ${e.text}`));
      } },

    /* --- windows --- */
    { name: "Change Chart Type",
      args: [{ type: "chart", prompt: "a chart window" },
             { type: "chart-type", kind: "menu", prompt: "chart type", options: ["line", "bars", "area"] }],
      appliesTo: (p) => p.type === "panel" && panelById(p.object)?.kind === "chart",
      coerceFirst: (p) => ({ ...p, type: "chart" }),
      run: ([id, kind]) => { setPanels((ps) => ps.map((p) => p.id === id ? { ...p, chartType: kind } : p)); print(`  → chart redrawn as ${kind.toUpperCase()}`); } },
    { name: "Expose", args: [{ type: "panel", prompt: "a window" }], dflt: "panel",
      appliesTo: (p) => p.type === "panel",
      run: ([id]) => { raise(id); print(`  → window exposed`); } },
    { name: "Bury", args: [{ type: "panel", prompt: "a window" }],
      appliesTo: (p) => p.type === "panel",
      run: ([id]) => { bury(id); print(`  → window buried`); } },
    { name: "Kill Window", args: [{ type: "panel", prompt: "a window" }],
      appliesTo: (p) => p.type === "panel" && ["chart", "plan", "events", "result"].includes(panelById(p.object)?.kind) && p.object !== "p-events",
      run: ([id]) => { setPanels((ps) => ps.filter((p) => p.id !== id)); print(`  → window killed`); } },
    { name: "Rename Window",
      args: [{ type: "panel", prompt: "a window" }, { type: "string", kind: "input", prompt: "new label" }],
      appliesTo: (p) => p.type === "panel",
      run: ([id, name]) => { setPanels((ps) => ps.map((p) => p.id === id ? { ...p, title: String(name).toUpperCase() } : p)); print(`  → window renamed`); } },
    { name: "Plot Category", args: [{ type: "category", prompt: "a category" }], dflt: "category",
      appliesTo: (p) => p.type === "category" && CATS.includes(p.object),
      run: ([cat]) => {
        const ids = METRIC_DEFS.filter((m) => m.cat === cat).map((m) => m.id);
        addChart(ids.slice(0, 2), "line", "PLOT: |C|" + cat);
        print(`  → plotted first two metrics of ${cat}`);
      } },
  ];

  const GLOBAL_ITEMS = () => [
    { label: "New Task…", action: () => startCommand(COMMANDS.find((c) => c.name === "New Task"), null) },
    { label: "New Plan…", action: () => startCommand(COMMANDS.find((c) => c.name === "New Plan"), null) },
    { label: "New Chart…", action: () => startCommand(COMMANDS.find((c) => c.name === "Plot Metric"), null) },
    { label: "Compare Metrics…", action: () => startCommand(COMMANDS.find((c) => c.name === "Compare Metrics"), null) },
    { label: "Assign Task…", action: () => startCommand(COMMANDS.find((c) => c.name === "Assign Task"), null) },
    { label: "Open Events…", action: () => startCommand(COMMANDS.find((c) => c.name === "Open Events"), null) },
    { divider: true },
    { label: paused ? "Resume World" : "Pause World", action: () => { setPaused((p) => !p); print(`Command: ${paused ? "Resume" : "Pause"} World`, "echo"); } },
    { label: "Redraw (reseed metrics)", action: () => { setSeriesMap(Object.fromEntries(METRIC_DEFS.map((d) => [d.id, genSeries(d)]))); print("Command: Redraw", "echo"); } },
    { label: "Clear Listener", action: () => setHistory([]) },
  ];

  /* ------- accept loop ------- */
  const notePointer = (e) => { pointer.current = { x: e.clientX, y: e.clientY }; };

  const runCommand = (cmd, presArgs) => {
    print("Command: " + cmd.name +
      presArgs.map((a, i) => ` (${cmd.args[i]?.type ?? a.type}) ${a.label}`).join(""), "echo");
    cmd.run(presArgs.map((a) => a.object), presArgs);
  };

  const advance = (cmd, args) => {
    if (args.length >= cmd.args.length) {
      setAccepting(null);
      runCommand(cmd, args);
      return;
    }
    const spec = cmd.args[args.length];
    setAccepting({ cmd, args, spec });
    setInputVal("");
    if (spec.kind === "menu") {
      setMenu({
        x: pointer.current.x + 8, y: pointer.current.y + 8,
        title: "Select " + spec.prompt + ":",
        items: spec.options.map((o) => ({
          label: o.toUpperCase(),
          action: () => {
            const a = acceptingRef.current;
            if (a) advance(a.cmd, [...a.args, { type: spec.type, object: o, label: o.toUpperCase() }]);
          },
        })),
      });
    }
  };

  const startCommand = (cmd, seedPres) => {
    setMenu(null);
    let args = [];
    if (seedPres && cmd.args.length) {
      const p = cmd.coerceFirst ? cmd.coerceFirst(seedPres) : seedPres;
      if (specMatches(cmd.args[0], p)) args = [p];
    }
    advance(cmd, args);
  };

  const supplyArg = (pres) => {
    const a = acceptingRef.current;
    if (!a) return;
    const p = a.cmd.coerceFirst && a.args.length === 0 ? a.cmd.coerceFirst(pres) : pres;
    advance(a.cmd, [...a.args, p]);
  };

  const abort = () => {
    if (acceptingRef.current) print("  [Abort]");
    setAccepting(null);
    setMenu(null);
  };

  const submitInput = () => {
    const a = acceptingRef.current;
    if (!a) return;
    let obj = inputVal.trim();
    if (a.spec.type === "number") {
      const v = parseFloat(obj);
      if (isNaN(v)) { print("  ?? not a NUMBER: " + obj); return; }
      obj = v;
    }
    if (obj === "") return;
    advance(a.cmd, [...a.args, { type: a.spec.type, object: obj, label: String(obj) }]);
  };

  const defaultAction = (pres) => {
    const cmd = COMMANDS.find((c) => c.dflt === pres.type && c.appliesTo(pres)) ||
                COMMANDS.find((c) => c.name === "Describe");
    startCommand(cmd, pres);
  };

  const applicableTo = (pres) => COMMANDS.filter((c) => {
    const p = c.coerceFirst ? c.coerceFirst(pres) : pres;
    return c.args.length > 0 && specMatches(c.args[0], p) && c.appliesTo(pres);
  });

  const openCommandMenu = (x, y, pres) => {
    setMenu({
      x, y,
      title: `${pres.label} — a ${pres.type.toUpperCase()}`,
      items: applicableTo(pres).map((c) => ({
        label: c.name + (c.args.length > 1 || c.args.some((a) => a.kind) ? "…" : ""),
        action: () => startCommand(c, pres),
      })),
    });
  };

  const openBackgroundMenu = (e) => {
    e.preventDefault();
    notePointer(e);
    if (acceptingRef.current) { abort(); return; }
    setMenu({ x: e.clientX, y: e.clientY, title: "Dashboard operations:", items: GLOBAL_ITEMS() });
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") abort(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ------- mouse doc line ------- */
  let mouseDoc;
  if (accepting) {
    mouseDoc = `Accepting ${accepting.spec.prompt || accepting.spec.type} (a ${accepting.spec.type.toUpperCase()}) for ${accepting.cmd.name} — ` +
      (accepting.spec.kind ? "type or pick from menu; " : "L: click a highlighted object; ") + "R / Esc: abort.";
  } else if (hoverPres) {
    const d = COMMANDS.find((c) => c.dflt === hoverPres.type && c.appliesTo(hoverPres));
    mouseDoc = `${hoverPres.label}: L: ${(d || { name: "Describe" }).name}; M: Describe; R: menu of ${applicableTo(hoverPres).length} operations.`;
  } else {
    mouseDoc = "L, M: nothing here; R: dashboard command menu. Drag title bars to move, ◢ to resize.";
  }

  const ui = {
    accepting, setHoverDoc: setHoverPres, supplyArg, defaultAction, describe,
    openCommandMenu, abort, notePointer,
  };

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ts = `[${days[clock.getDay()]} ${clock.getDate()} ${months[clock.getMonth()]} ${clock.toLocaleTimeString([], { hour12: false })}]`;
  const busy = agents.filter((a) => a.taskId).length;
  const qd = tasks.filter((t) => t.status === "QUEUED" || t.status === "BLOCKED").length;

  return (
    <UICtx.Provider value={ui}>
      <div className={`app ${accepting ? "accepting" : ""}`}>
        <style>{CSS}</style>

        <div className="topline">;;; -*- Mode: DASHBOARD; Syntax: JavaScript; Package: METRICS; Cooperation: TASK-DISPATCH -*-</div>

        <div className="desktop" onContextMenu={openBackgroundMenu} onClick={() => setMenu(null)}>
          {panels.map((p) => (
            <Win key={p.id} panel={p}
              onDrag={(id, x, y) => setPanels((ps) => ps.map((q) => q.id === id ? { ...q, x, y } : q))}
              onResize={(id, w, h) => setPanels((ps) => ps.map((q) => q.id === id ? { ...q, w, h } : q))}
              onRaise={raise}>
              {p.kind === "tree" && <TreePane metrics={METRIC_DEFS} panel={p} />}
              {p.kind === "table" && <TablePane metrics={METRIC_DEFS} seriesMap={seriesMap} thresholds={thresholds} />}
              {p.kind === "chart" && <ChartPane panel={p} metrics={METRIC_DEFS} seriesMap={seriesMap} thresholds={thresholds} />}
              {p.kind === "queue" && <QueuePane tasks={tasks} agents={agents} />}
              {p.kind === "roster" && <RosterPane agents={agents} tasks={tasks} />}
              {p.kind === "dispatch" && <DispatchPane agents={agents} tasks={tasks} panel={p} />}
              {p.kind === "plan" && <PlanPane panel={p} plans={plans} tasks={tasks} />}
              {p.kind === "events" && <EventsPane panel={p} events={events} agents={agents} />}
              {p.kind === "result" && <ResultPane panel={p} tasks={tasks} />}
            </Win>
          ))}
          <Menu menu={menu} onClose={() => setMenu(null)} />
        </div>

        <div className="runbar">
          DW-METRICS (Dashboard) task-dispatch *metrics* ({METRIC_DEFS.length}) — {busy}/{agents.length} agents busy, {qd} tasks pending, {plans.length} plans {paused ? "[World paused]" : "[More below]"}
        </div>

        <div className="listener" ref={histRef}>
          {history.map((l, i) => (
            <div key={i} className={"hl " + l.kind}>{l.text}</div>
          ))}
          <div className="hl prompt">
            {accepting ? (
              <>
                <span className="echo">
                  Command: {accepting.cmd.name}
                  {accepting.args.map((a, i) => ` (${accepting.cmd.args[i].type}) ${a.label}`).join("")}
                  {" "}({accepting.spec.type})&nbsp;
                </span>
                {accepting.spec.kind === "input" ? (
                  <input
                    ref={inputRef} className="arg-input" value={inputVal}
                    onChange={(e) => setInputVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitInput(); if (e.key === "Escape") abort(); }}
                    placeholder={accepting.spec.prompt}
                  />
                ) : accepting.spec.kind === "menu" ? (
                  <span className="hint">⟨choose from menu⟩</span>
                ) : (
                  <span className="hint">⟨click a {accepting.spec.type.toUpperCase()}⟩<span className="cursor">█</span></span>
                )}
              </>
            ) : (
              <>Command: <span className="cursor">█</span></>
            )}
          </div>
        </div>

        <div className="mousedoc">{mouseDoc}</div>
        <div className="statusline">
          <span>{ts}</span>
          <span>USER</span>
          <span>METRICS:</span>
          <span className="ul">{accepting ? "Accept " + accepting.spec.type : "User Input"}</span>
          <span className="spacer" />
          <span className={paused ? "c-gold" : "c-teal"}>{paused ? "WORLD: PAUSED" : "WORLD: LIVE"}</span>
        </div>
      </div>
    </UICtx.Provider>
  );
}

/* ----------------------------- CSS ------------------------------- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap');

.app {
  /* 50s surf palette — ink stays black; color is font-only accent */
  --fg: #000; --bg: #fff;
  --teal: #00787c;   /* lagoon teal — running / live */
  --coral: #d5492a;  /* coral — failed / urgent */
  --gold: #a97b0e;   /* board-wax mustard — blocked / paused / high */
  font-family: "IBM Plex Mono", "Menlo", "Consolas", monospace;
  font-size: 12px; line-height: 1.35;
  color: var(--fg); background: var(--bg);
  height: 100vh; display: flex; flex-direction: column;
  user-select: none; overflow: hidden;
}
.app * { box-sizing: border-box; }

.c-teal  { color: var(--teal);  font-weight: 700; }
.c-coral { color: var(--coral); font-weight: 700; }
.c-gold  { color: var(--gold);  font-weight: 700; }
.draft   { font-style: italic; opacity: .75; }
.dimtext { opacity: .6; font-style: italic; }

/* SVG font-color equivalents */
.g-c-teal  { fill: var(--teal);  font-weight: 700; }
.g-c-coral { fill: var(--coral); font-weight: 700; }
.g-c-gold  { fill: var(--gold);  font-weight: 700; }
.g-ink     { fill: #000; }
.g-draft   { fill: #000; opacity: .6; }

.topline {
  padding: 2px 8px; border-bottom: 2px solid #000; background: #fff;
  white-space: nowrap; overflow: hidden;
}

.desktop {
  position: relative; flex: 1; overflow: hidden;
  background-color: #fff;
  background-image: radial-gradient(#000 0.8px, transparent 0.8px);
  background-size: 4px 4px;
}

/* windows */
.win {
  position: absolute; background: #fff; border: 2px solid #000;
  box-shadow: 4px 4px 0 rgba(0,0,0,0.85);
  display: flex; flex-direction: column;
}
.win-title {
  background: #000; color: #fff; padding: 2px 8px;
  display: flex; justify-content: space-between; align-items: center;
  cursor: move; font-weight: 700; letter-spacing: 0.06em;
}
.win-title-pres { color: #fff; }
.win-deco { opacity: .7; font-size: 10px; }
.win-body { flex: 1; overflow: auto; padding: 8px; }
.win-resize {
  position: absolute; right: 0; bottom: 0; width: 16px; height: 16px;
  cursor: nwse-resize; font-size: 11px; line-height: 16px; text-align: center;
  color: #000; background: #fff; border-left: 1.5px solid #000; border-top: 1.5px solid #000;
}
.win-resize:hover { background: #000; color: #fff; }

/* presentations */
.pres { cursor: pointer; padding: 0 2px; }
.pres:hover { background: #000; color: #fff !important; }
.pres:hover svg { filter: invert(1); }
.win-title .pres:hover { background: #fff; color: #000 !important; }
.app.accepting .pres.inert, .app.accepting .pres-g.inert { opacity: .3; pointer-events: none; }
.pres.eligible {
  outline: 2px dashed #000; outline-offset: 2px;
  animation: blinkout 0.9s steps(2) infinite;
}
@keyframes blinkout { 50% { outline-color: transparent; } }
.pres-g { cursor: pointer; }
.pres-g .nodebox { fill: #fff; stroke: #000; stroke-width: 1.6; }
.pres-g .boxtext { font-size: 11px; font-weight: 500; fill: #000; }
.pres-g .boxtext.sub { font-size: 9px; opacity: .7; }
.pres-g:hover .nodebox { fill: #000; }
.pres-g:hover .boxtext, .pres-g:hover .boxtext tspan { fill: #fff; }
.pres-g .nodedisc { fill: #000; stroke: #000; }
.pres-g .disctext { fill: #fff; font-size: 11px; font-weight: 700; letter-spacing: .04em; }
.pres-g .disctext.small { font-size: 9.5px; letter-spacing: .02em; }
.pres-g:hover .nodedisc { fill: #fff; stroke-width: 3; }
.pres-g:hover .disctext { fill: #000; }
.pres-g .idlemark { font-size: 9px; fill: #000; opacity: .65; font-style: italic; }
.pres-g .pausemark { font-size: 12px; font-weight: 700; fill: var(--gold); }
.pres-g.eligible .nodebox, .pres-g.eligible .nodedisc {
  stroke-dasharray: 5 3; stroke-width: 2.6;
  animation: march 0.6s linear infinite;
}
@keyframes march { to { stroke-dashoffset: -8; } }

/* tables */
.mtable { border-collapse: collapse; width: 100%; }
.mtable th {
  text-align: left; border-bottom: 2px solid #000; padding: 1px 8px 3px 2px;
  font-size: 11px; letter-spacing: .08em;
}
.mtable td { padding: 2px 8px 2px 2px; border-bottom: 1px dotted #000; white-space: nowrap; }
.mtable td.rv { background: #000; color: #fff; font-weight: 700; }
.mtable tr.dim { opacity: .45; }
.qtable .target { max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
.qtable .prog { font-size: 11px; letter-spacing: -.5px; }
.deps { font-size: 11px; opacity: .8; }
.takes { font-size: 10px; }
.spark { vertical-align: middle; display: inline-block; }
.cell-pres { font-weight: 700; }

/* charts */
.chartwrap { height: 100%; display: flex; flex-direction: column; gap: 4px; }
.legend { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.legend-item { font-weight: 700; }
.swatch { letter-spacing: -1px; }
.charttype { margin-left: auto; font-size: 10px; opacity: .8; }
.chartbody { display: flex; gap: 4px; flex: 1; }
.yaxis {
  display: flex; flex-direction: column; justify-content: space-between;
  font-size: 10px; text-align: right; width: 42px; padding: 0 2px;
}
.thlabel { font-size: 9px; fill: #000; font-weight: 700; }

/* plans */
.planwrap { display: flex; flex-direction: column; gap: 6px; min-width: min-content; }
.planhead { display: flex; gap: 8px; align-items: baseline; border-bottom: 1px dotted #000; padding-bottom: 3px; }
.plancounts { font-size: 10px; }
.pad-note { padding: 10px 4px; font-style: italic; opacity: .7; }
.pad-hint { font-size: 9.5px; opacity: .55; border-top: 1px dotted #000; padding-top: 3px; }

/* events */
.evwrap { display: flex; flex-direction: column; gap: 4px; height: 100%; }
.evfilter {
  display: flex; align-items: baseline; gap: 4px; flex-wrap: wrap;
  border-bottom: 2px solid #000; padding-bottom: 3px; font-size: 11px; letter-spacing: .05em;
}
.evfilter .spacer { flex: 1; }
.chip { border: 1.5px solid #000; padding: 0 5px; font-weight: 700; font-size: 10.5px; }
.evtable td { font-size: 11px; }
.evtable .evtime { opacity: .65; }

/* results */
.reswrap { display: flex; flex-direction: column; gap: 8px; }
.reshead { border-bottom: 2px solid #000; padding-bottom: 4px; }
.kvtable { width: auto; }
.kvtable .kvkey { font-size: 10px; letter-spacing: .08em; opacity: .75; padding-right: 18px; }
.resrows { border: 1.5px solid #000; padding: 5px 8px; font-size: 11px; line-height: 1.5; }

/* menus */
.menu {
  position: fixed; z-index: 999; background: #fff;
  border: 2px solid #000; box-shadow: 5px 5px 0 rgba(0,0,0,.9);
  min-width: 200px; padding-bottom: 2px;
}
.menu-title {
  text-align: center; font-weight: 700; padding: 3px 10px;
  border-bottom: 2px solid #000; letter-spacing: .04em;
}
.menu-item { padding: 2px 14px; text-align: center; cursor: pointer; }
.menu-item:hover { background: #000; color: #fff; }
.menu-div { border-top: 1px dotted #000; margin: 3px 8px; }
.menu-abort { font-size: 11px; opacity: .85; }

/* run bar + listener */
.runbar {
  border-top: 2px solid #000; border-bottom: 1px solid #000;
  padding: 1px 8px; background: #fff; font-weight: 500;
  white-space: nowrap; overflow: hidden;
}
.listener {
  height: 128px; overflow-y: auto; background: #fff;
  padding: 4px 8px; border-bottom: 2px solid #000;
}
.hl { white-space: pre-wrap; }
.hl.echo { font-weight: 700; }
.hl.err { color: var(--coral); font-weight: 500; }
.hl.prompt { font-weight: 700; }
.echo { font-weight: 700; }
.hint { opacity: .75; font-weight: 400; }
.arg-input {
  font: inherit; font-weight: 700; border: none; border-bottom: 2px solid #000;
  outline: none; background: #fff; color: #000; width: 180px; padding: 0 2px;
}
.cursor { animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0; } }

/* mouse doc line */
.mousedoc {
  background: #000; color: #fff; font-weight: 700;
  padding: 3px 10px; letter-spacing: .02em; white-space: nowrap; overflow: hidden;
}
.statusline { display: flex; gap: 26px; padding: 2px 10px; background: #fff; }
.statusline .ul { text-decoration: underline; }
.statusline .spacer { flex: 1; }

@media (prefers-reduced-motion: reduce) {
  .pres.eligible, .pres-g.eligible .nodebox, .pres-g.eligible .nodedisc, .cursor { animation: none; }
}
`;

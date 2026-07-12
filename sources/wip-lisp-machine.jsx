import { useState, useEffect, useRef, useCallback } from "react";

/* ============================================================
   W I P  -  Prototype 2.0  —  now with a real interpreter.

   A small Lisp lives inside this file (reader, evaluator,
   closures, recursion) plus the WIP presentation-planning
   command LOCALIZE. Running a plan *computes* the spatial
   description from the actual geometry of the wireframe,
   expands the plan tree, streams the Trace, creates TAG
   objects word by word, and emits the English sentence.

   A Lisp Listener pane at the bottom holds the program;
   [Examples] loads runnable presets, [Run] (or Ctrl+Enter)
   evaluates them.
   ============================================================ */

const FONT = '"Px437 IBM VGA", "Fixedsys", "Lucida Console", "Consolas", "Menlo", monospace';
const F = 10, CH = 6.15, LH = 12, PAD = 4;

/* ==================== 1. THE READER ==================== */

function tokenize(src) {
  const toks = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === ";") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "(" || c === ")" || c === "'") { toks.push(c); i++; continue; }
    if (c === '"') {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== '"') s += src[j++];
      if (j >= src.length) throw new Error("Unterminated string.");
      toks.push({ str: s }); i = j + 1; continue;
    }
    let j = i, s = "";
    while (j < src.length && !/[\s()';"]/.test(src[j])) s += src[j++];
    const n = Number(s);
    toks.push(Number.isNaN(n) ? { sym: s.toUpperCase() } : n);
    i = j;
  }
  return toks;
}

function parseAll(toks) {
  const pos = { i: 0 }, forms = [];
  while (pos.i < toks.length) forms.push(parseForm(toks, pos));
  return forms;
}
function parseForm(toks, pos) {
  const t = toks[pos.i++];
  if (t === "(") {
    const l = [];
    while (toks[pos.i] !== ")") {
      if (pos.i >= toks.length) throw new Error("Unbalanced parentheses.");
      l.push(parseForm(toks, pos));
    }
    pos.i++; return l;
  }
  if (t === ")") throw new Error("Unexpected close parenthesis.");
  if (t === "'") return [{ sym: "QUOTE" }, parseForm(toks, pos)];
  if (t === undefined) throw new Error("Unexpected end of input.");
  return t;
}

/* ==================== 2. THE PRINTER ==================== */

function printLisp(v) {
  if (v === null || v === undefined) return "NIL";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.length ? "(" + v.map(printLisp).join(" ") + ")" : "NIL";
  if (v.sym) return v.sym;
  if (v.str !== undefined) return '"' + v.str + '"';
  if (v.lambda) return `#<CLOSURE ${v.name || "ANONYMOUS"}>`;
  if (typeof v === "function" || v.builtin) return "#<COMPILED-FUNCTION>";
  return String(v);
}
const trunc = (s, n = 66) => (s.length > n ? s.slice(0, n) + " ...)" : s);

/* ==================== 3. THE EVALUATOR ==================== */

function makeEnv(parent) { return { vars: new Map(), parent }; }
function lookup(env, name) {
  for (let e = env; e; e = e.parent) if (e.vars.has(name)) return e.vars.get(name);
  throw new Error(`The variable ${name} is unbound.`);
}
function setVar(env, name, val) {
  for (let e = env; e; e = e.parent) if (e.vars.has(name)) { e.vars.set(name, val); return; }
  env.vars.set(name, val);
}
const truthy = (v) => !(v === null || v === undefined || v === false || (Array.isArray(v) && v.length === 0));
const num = (v) => { if (typeof v !== "number") throw new Error(`${printLisp(v)} is not a number.`); return v; };
const asList = (v) => (v === null ? [] : Array.isArray(v) ? v : (() => { throw new Error(`${printLisp(v)} is not a list.`); })());

function makeGlobalEnv() {
  const g = makeEnv(null);
  const def = (n, fn) => g.vars.set(n, Object.assign(fn, { builtin: true }));
  g.vars.set("NIL", null);
  g.vars.set("T", { sym: "T" });
  def("+", (a) => a.reduce((x, y) => x + num(y), 0));
  def("*", (a) => a.reduce((x, y) => x * num(y), 1));
  def("-", (a) => (a.length === 1 ? -num(a[0]) : a.slice(1).reduce((x, y) => x - num(y), num(a[0]))));
  def("/", (a) => a.slice(1).reduce((x, y) => x / num(y), num(a[0])));
  def("MOD", (a) => num(a[0]) % num(a[1]));
  def("<", (a) => (num(a[0]) < num(a[1]) ? { sym: "T" } : null));
  def(">", (a) => (num(a[0]) > num(a[1]) ? { sym: "T" } : null));
  def("<=", (a) => (num(a[0]) <= num(a[1]) ? { sym: "T" } : null));
  def(">=", (a) => (num(a[0]) >= num(a[1]) ? { sym: "T" } : null));
  def("=", (a) => (num(a[0]) === num(a[1]) ? { sym: "T" } : null));
  def("EQ", (a) => (printLisp(a[0]) === printLisp(a[1]) ? { sym: "T" } : null));
  def("NOT", (a) => (truthy(a[0]) ? null : { sym: "T" }));
  def("LIST", (a) => a);
  def("CAR", (a) => { const l = asList(a[0]); return l.length ? l[0] : null; });
  def("CDR", (a) => { const l = asList(a[0]); return l.length > 1 ? l.slice(1) : null; });
  def("CONS", (a) => [a[0], ...asList(a[1])]);
  def("LENGTH", (a) => asList(a[0]).length);
  def("REVERSE", (a) => [...asList(a[0])].reverse());
  return g;
}

function evalForm(f, env, fx) {
  if (++fx.steps > 200000) throw new Error("Evaluation exceeded the step limit (infinite loop?).");
  if (typeof f === "number") return f;
  if (f === null || f === undefined) return null;
  if (f.str !== undefined) return f;
  if (f.sym) return lookup(env, f.sym);
  if (Array.isArray(f)) {
    if (f.length === 0) return null;
    const op = f[0] && f[0].sym;
    switch (op) {
      case "QUOTE": return f[1];
      case "IF":
        return truthy(evalForm(f[1], env, fx))
          ? evalForm(f[2], env, fx)
          : f.length > 3 ? evalForm(f[3], env, fx) : null;
      case "PROGN": { let r = null; for (const g of f.slice(1)) r = evalForm(g, env, fx); return r; }
      case "SETQ": { const v = evalForm(f[2], env, fx); setVar(env, f[1].sym, v); return v; }
      case "LET": {
        const e = makeEnv(env);
        for (const [s, init] of f[1]) e.vars.set(s.sym, evalForm(init, env, fx));
        let r = null; for (const g of f.slice(2)) r = evalForm(g, e, fx); return r;
      }
      case "DEFUN": {
        const fn = { lambda: true, name: f[1].sym, params: f[2].map((p) => p.sym), body: f.slice(3), env };
        setVar(env, f[1].sym, fn);
        return { sym: f[1].sym };
      }
      case "LAMBDA":
        return { lambda: true, params: f[1].map((p) => p.sym), body: f.slice(2), env };
      case "PRINT": {
        const v = evalForm(f[1], env, fx);
        fx.trace(printLisp(v), "val");
        return v;
      }
      case "LOCALIZE": return planLocalize(f, env, fx);
      default: {
        const fn = evalForm(f[0], env, fx);
        const args = f.slice(1).map((a) => evalForm(a, env, fx));
        return applyFn(fn, args, fx);
      }
    }
  }
  throw new Error(`Cannot evaluate ${printLisp(f)}.`);
}

function applyFn(fn, args, fx) {
  if (typeof fn === "function") return fn(args);
  if (fn && fn.lambda) {
    if (args.length !== fn.params.length)
      throw new Error(`${fn.name || "Function"} called with ${args.length} arguments, wants ${fn.params.length}.`);
    const e = makeEnv(fn.env);
    fn.params.forEach((p, i) => e.vars.set(p, args[i]));
    let r = null; for (const g of fn.body) r = evalForm(g, e, fx); return r;
  }
  throw new Error(`${printLisp(fn)} is not a function.`);
}

/* ==================== 4. THE PRESENTATION PLANNER ==================== */

/* Graphic objects in PIC-13321, with their real bounding boxes
   in the clipboard's coordinate system (viewBox 0 0 300 260).
   The picture frame is x:30..262, y:24..222.                       */
const PIC = { x: 30, y: 24, w: 232, h: 198 };
const PARTS = {
  "SWITCH-2":    { nl: "on/off switch",   typeSym: "ON/OFF-SWITCH",   bbox: { x: 194, y: 88,  w: 24,  h: 34 } },
  "CONTAINER-1": { nl: "water container", typeSym: "WATER-CONTAINER", bbox: { x: 118, y: 80,  w: 44,  h: 116 } },
  "PORTHOLE-1":  { nl: "brew gauge",      typeSym: "BREW-GAUGE",      bbox: { x: 54,  y: 53,  w: 24,  h: 24 } },
  "BASE-1":      { nl: "drip tray",       typeSym: "DRIP-TRAY",       bbox: { x: 34,  y: 178, w: 228, h: 44 } },
};

function locateRegion(bbox) {
  const relX = (bbox.x + bbox.w / 2 - PIC.x) / PIC.w;
  const relY = (bbox.y + bbox.h / 2 - PIC.y) / PIC.h;
  const h = relX < 0.4 ? "LEFT" : relX > 0.6 ? "RIGHT" : null;
  const v = relY < 0.42 ? "TOP" : relY > 0.58 ? "BOTTOM" : null;
  const vw = v === "TOP" ? "upper" : v === "BOTTOM" ? "lower" : null;
  const hw = h && h.toLowerCase();
  let phrase, head, adjs, rels;
  if (v && h)      { head = "corner"; adjs = [hw, vw]; phrase = `${vw} ${hw} corner`; rels = [v, h]; }
  else if (v)      { head = "part";   adjs = [vw];     phrase = `${vw} part`;         rels = [v]; }
  else if (h)      { head = "part";   adjs = [hw];     phrase = `${hw} part`;         rels = [h]; }
  else             { head = "center"; adjs = [];       phrase = "center";             rels = ["CENTER"]; }
  return { phrase, head, adjs, rels, relX: relX.toFixed(2), relY: relY.toFixed(2) };
}

/* (LOCALIZE (OBJECT <part>) (PICTURE <pic>)) — expands the plan,
   computes the location, and emits every effect the UI plays back. */
function planLocalize(f, env, fx) {
  const objArg = f[1], obj = objArg && objArg[1] && objArg[1].sym;
  const pic = (f[2] && f[2][1] && f[2][1].sym) || "PIC-13321";
  if (!obj || !PARTS[obj])
    throw new Error(`Unknown graphic object ${obj || printLisp(objArg)}. Known objects: ${Object.keys(PARTS).join(", ")}.`);
  const part = PARTS[obj];
  const loc = locateRegion(part.bbox);
  const k = ++fx.planCount;
  const id = (s) => `${s}-${k}`;
  const N = (idSuffix, parent, lines) => fx.node({ id: id(idSuffix), parent: parent && id(parent), lines });

  const descLines = loc.rels.length > 1
    ? ["   (AND", ...loc.rels.map((r, i) => `     (${r} ${obj} ${pic})${i === loc.rels.length - 1 ? ")" : ""}`)]
    : [`   (${loc.rels[0]} ${obj} ${pic})`];
  const relSexp = loc.rels.length > 1
    ? ["  (2D-S-REL", "   (AND", ...loc.rels.map((r, i) => `    (${r} ${obj} ${pic})${i === loc.rels.length - 1 ? "))))" : ""}`)]
    : ["  (2D-S-REL", `   (${loc.rels[0]} ${obj} ${pic})))`];

  fx.highlight(obj);
  N("localize", null, ["(LOCALIZE P A", `  (OBJECT ${obj}) G)`]);
  fx.trace(`GD: LOC-SYS: #S(LOCATION-STRUCT`, "gd");
  fx.trace(`        LOC-TYPE ABSOLUTE`);
  fx.trace(`        APPLICABILITY T`);
  fx.trace(`        VIOLATED-RULE NIL`);
  fx.trace(`**MORE**        ELEMENTARY`);
  fx.trace(`        (REL-POS ${loc.relX} ${loc.relY})`);
  fx.trace(`        ELEMENTARY-LOC-STR ${loc.rels[0]}`);
  fx.trace(`        ELEMENTARY-EVIDENCE-VAL 1`);
  fx.trace(`        COMPOSITE-LOC-POSSIBLE ${loc.rels.length > 1 ? "T" : "NIL"}`);
  fx.trace(`        COMPOSITE-LOC-STR`);
  fx.trace(`        (${loc.rels.join(" ")})`);
  fx.trace(`        COMPOSITE-EVIDENCE-VAL 1)`);

  N("elaborate", "localize", ["(ELABORATE P A", `  (LOCATION ${obj} ${pic}) T)`]);
  N("background", "localize", ["(BACKGROUND P A", `  (OBJECT ${obj}) ${obj} ${pic} G)`]);
  N("s-depict-obj", "localize", ["(S-DEPICT P A", `  (OBJECT ${obj}) ${obj} ${pic})`]);
  N("s-depict-machine", "background", ["(S-DEPICT P A", "  (OBJECT ESPRESSOMACHINE-1) ESPRESSO"]);

  fx.trace("PP: Generated Description:", "gd");
  descLines.forEach((l) => fx.trace(l));
  fx.trace("Scheduler: next task process: TD", "sched");

  N("activate-refo", "elaborate",
    ["(ACTIVATE P A", `  (REFO ${pic} #1=`, `    (THE ${pic}`, `      (PICTURE ${pic}))) #1# T)`]);
  N("activate-subject", "elaborate",
    ["(ACTIVATE P A", `  (SUBJECT ${obj})`, `  (THE ${obj}`, `    (${part.typeSym} ${obj})) T)`]);
  const assertLines = [
    "(S-ASSERT P A", "  (SUBJECT", `    (THE ${obj}`, `      (${part.typeSym} ${obj})))`,
    "  (REFO", `    (THE ${pic}`, `      (PICTURE ${pic})))`, ...relSexp,
  ];
  N("s-assert", "elaborate", assertLines);
  fx.trace("TD: Next task to be performed:", "gd");
  assertLines.forEach((l) => fx.trace(l));

  fx.trace("TD: Input for Tag-Gen:", "gd");
  fx.trace(`    ((E NP-3`);
  fx.trace(`      ((HEAD ${loc.head}) (NUM SG) (CAT N)`);
  fx.trace(`       (GENDER NTR) (SPECIFIER DEFINITE)`);
  fx.trace(`      ))`);
  loc.adjs.forEach((adj, i) => {
    fx.trace(`     (E ADJP-${i + 1} ((HEAD ${adj}) (CAT ADJ)))`);
    fx.trace(`     (R NP-3 MOD-NP-${i + 1} ADJP-${i + 1})`);
    fx.trace(`     (E MOD-NP-${i + 1} ((FUNC NP)))`);
  });
  fx.trace(`    )`);

  fx.anno(part.nl);
  const t0 = 51.72;
  const words = [loc.head, "the", ...loc.adjs];
  words.forEach((w, i) => {
    fx.word(w);
    fx.trace(`TAG: TAG-Object "${w}" created (${(t0 + i * 0.045).toFixed(2)} s)`, "gd");
  });
  loc.adjs.forEach((_, i) =>
    fx.trace(`TAG: monitor -> ADJP-${loc.adjs.length - i}: registered (${(t0 + words.length * 0.045 + i * 0.035).toFixed(2)} s)`, "gd"));
  fx.trace(`TAG: monitor -> DET-NP-3: registered (${(t0 + words.length * 0.045 + loc.adjs.length * 0.035).toFixed(2)} s)`, "gd");

  const sentence = `The ${part.nl} is located in the ${loc.phrase} of the picture .`;
  fx.final(sentence);
  fx.trace(`TAG: utterance -> "${sentence}"`, "gd");
  return { str: sentence };
}

/* ==================== 5. PROGRAM RUNNER ==================== */

function compileProgram(src) {
  const fx = {
    effects: [], steps: 0, planCount: 0,
    trace(text, kind) { this.effects.push({ t: "trace", text, kind }); },
    node(node) { this.effects.push({ t: "node", node }); },
    anno(nl) { this.effects.push({ t: "anno", nl }); },
    word(w) { this.effects.push({ t: "word", w }); },
    final(text) { this.effects.push({ t: "final", text }); },
    highlight(p) { this.effects.push({ t: "highlight", p }); },
  };
  let forms;
  try { forms = parseAll(tokenize(src)); }
  catch (e) { fx.trace(">>Error: " + e.message, "err"); return fx.effects; }
  const env = makeGlobalEnv();
  for (const form of forms) {
    fx.trace("> " + trunc(printLisp(form)), "echo");
    try {
      const val = evalForm(form, env, fx);
      fx.trace("=> " + trunc(printLisp(val)), "echo");
    } catch (e) {
      fx.trace(">>Error: " + (e instanceof RangeError ? "Control stack overflow." : e.message), "err");
      break;
    }
  }
  return fx.effects;
}

/* ==================== 6. PRESET EXAMPLES ==================== */

const PRESETS = [
  {
    name: "Localize the on/off switch",
    src: `;; WIP demo: where is SWITCH-2 in PIC-13321?
;; The location is computed from the drawing's geometry.
(localize (object switch-2) (picture pic-13321))`,
  },
  {
    name: "Localize the brew gauge",
    src: `;; The big porthole -- this one reproduces the classic
;; "upper left corner" sentence from the 1992 demo.
(localize (object porthole-1) (picture pic-13321))`,
  },
  {
    name: "Localize the water container",
    src: `(localize (object container-1) (picture pic-13321))`,
  },
  {
    name: "Two plans in one run",
    src: `;; Plans compose: each LOCALIZE grows its own subtree.
(localize (object switch-2) (picture pic-13321))
(localize (object base-1) (picture pic-13321))`,
  },
  {
    name: "Recursion: factorial",
    src: `;; Plain Lisp works too. PRINT writes to the Trace.
(defun fact (n)
  (if (< n 2) 1 (* n (fact (- n 1)))))
(print (fact 10))
(print (fact 20))`,
  },
  {
    name: "List processing",
    src: `(setq parts '(switch-2 container-1 porthole-1 base-1))
(print (length parts))
(print (cons 'espressomachine-1 parts))
(print (reverse parts))
(print (+ (* 6 7) (- 100 58)))`,
  },
  {
    name: "Error handling",
    src: `;; The listener reports errors the Genera way.
(print (car '(a b c)))
(localize (object grinder-9) (picture pic-13321))`,
  },
];

/* ==================== 7. TREE LAYOUT ==================== */

const nodeGeom = (n) => ({
  w: Math.max(...n.lines.map((l) => l.length)) * CH + PAD * 2 + 2,
  h: n.lines.length * LH + PAD * 2,
});

function layoutNodes(raw) {
  const nodes = raw.map((n) => ({ ...n, ...nodeGeom(n) }));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const depth = (n) => (n.parent && byId[n.parent] ? 1 + depth(byId[n.parent]) : 0);
  nodes.forEach((n) => (n.d = depth(n)));
  const maxD = Math.max(0, ...nodes.map((n) => n.d));
  const colW = [], colX = [];
  for (let d = 0; d <= maxD; d++) colW[d] = Math.max(0, ...nodes.filter((n) => n.d === d).map((n) => n.w));
  colX[0] = 8;
  for (let d = 1; d <= maxD; d++) colX[d] = colX[d - 1] + colW[d - 1] + 54;
  const cursor = new Array(maxD + 1).fill(8);
  const kidsOf = (id) => nodes.filter((n) => n.parent === id);
  function place(n) {
    const kids = kidsOf(n.id);
    if (kids.length === 0) n.y = cursor[n.d];
    else {
      kids.forEach(place);
      const mid = (kids[0].y + kids[0].h / 2 + kids[kids.length - 1].y + kids[kids.length - 1].h / 2) / 2;
      n.y = Math.max(mid - n.h / 2, cursor[n.d]);
    }
    cursor[n.d] = n.y + n.h + 14;
    n.x = colX[n.d];
  }
  nodes.filter((n) => !n.parent || !byId[n.parent]).forEach(place);
  return nodes;
}

/* ==================== 8. THE SCREEN ==================== */

const DEFAULT_DOC = "Mouse-L: Select object;  Mouse-M: Describe;  Mouse-R: Presentation menu.";

export default function WipLispMachine() {
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);
  const [mouseDoc, setMouseDoc] = useState(DEFAULT_DOC);
  const [menu, setMenu] = useState(null);
  const [exMenu, setExMenu] = useState(null);
  const [trace, setTrace] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [tag, setTag] = useState(null); // {nl, words[], final}
  const [highlightPart, setHighlightPart] = useState(null);
  const [source, setSource] = useState(PRESETS[0].src);
  const [running, setRunning] = useState(false);
  const traceRef = useRef(null);
  const timerRef = useRef(null);

  const appendTrace = useCallback((lines) => {
    setTrace((t) => [...t, ...lines.map((l) => (typeof l === "string" ? { text: l } : l))]);
  }, []);

  const runProgram = useCallback((src) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTrace([]); setNodes([]); setTag(null); setHighlightPart(null); setSelected(null);
    setRunning(true);
    const effects = compileProgram(src);
    let i = 0;
    timerRef.current = setInterval(() => {
      if (i >= effects.length) { clearInterval(timerRef.current); setRunning(false); return; }
      const e = effects[i++];
      if (e.t === "trace") setTrace((t) => [...t, { text: e.text, kind: e.kind }]);
      if (e.t === "node") setNodes((n) => [...n, e.node]);
      if (e.t === "anno") setTag({ nl: e.nl, words: [], final: null });
      if (e.t === "word") setTag((t) => (t ? { ...t, words: [...t.words, e.w] } : t));
      if (e.t === "final") setTag((t) => (t ? { ...t, final: e.text } : t));
      if (e.t === "highlight") setHighlightPart(e.p);
    }, 65);
  }, []);

  useEffect(() => { runProgram(PRESETS[0].src); return () => clearInterval(timerRef.current); }, [runProgram]);
  useEffect(() => { const el = traceRef.current; if (el) el.scrollTop = el.scrollHeight; }, [trace]);

  /* --- presentation plumbing --- */
  const presEnter = (pres) => {
    setHovered(pres.id);
    setMouseDoc(`Mouse-L: Inspect ${pres.label};  Mouse-M: Describe;  Mouse-R: Menu of ${pres.type}.`);
  };
  const presLeave = () => { setHovered(null); setMouseDoc(DEFAULT_DOC); };
  const presClick = (pres) => {
    setSelected((s) => (s === pres.id ? null : pres.id));
    appendTrace([
      { text: `> :Inspect ${pres.label}`, kind: "echo" },
      { text: `#<${pres.type} ${pres.id.toUpperCase()} ${(Math.random() * 0xffffff | 0).toString(8).padStart(8, "0")}>` },
    ]);
  };
  const presMenu = (e, pres) => { e.preventDefault(); setExMenu(null); setMenu({ x: e.clientX, y: e.clientY, pres }); };
  const runMenuAction = (action) => {
    const { pres } = menu;
    if (action === "Inspect") presClick(pres);
    if (action === "Describe")
      appendTrace([
        { text: `> :Describe ${pres.label}`, kind: "echo" },
        { text: `${pres.label}, a presentation of type ${pres.type},` },
        { text: `is displayed in pane ${pres.pane}.` },
      ]);
    if (action === "Copy Form") {
      try { navigator.clipboard.writeText(pres.form || pres.label); } catch (_) {}
      appendTrace([{ text: `> :Copy Form ${pres.label}  [yanked to kill ring]`, kind: "echo" }]);
    }
    setMenu(null);
  };

  /* parts mentioned by hovered/selected tree node get marked in the drawing */
  const hotParts = new Set(highlightPart ? [highlightPart] : []);
  nodes.forEach((n) => {
    if (n.id === hovered || n.id === selected)
      Object.keys(PARTS).forEach((p) => { if (n.lines.some((l) => l.includes(p))) hotParts.add(p); });
  });

  return (
    <div
      onClick={() => { setMenu(null); setExMenu(null); }}
      style={{ background: "#000", minHeight: "100vh", padding: 10, fontFamily: FONT, color: "#000", userSelect: "none" }}
    >
      <style>{`
        @keyframes blink1bit { 0%,49% {opacity:1} 50%,100% {opacity:0} }
        .crt-cursor { display:inline-block; width:7px; height:11px; background:#000;
          vertical-align:-2px; animation: blink1bit 1s steps(1) infinite; }
        .blinkrect { animation: blink1bit 1.2s steps(1) infinite; }
        .hatch { background-image: repeating-linear-gradient(45deg,#000 0px,#000 1px,#fff 1px,#fff 3px); }
        .menu-item:hover { background:#000; color:#fff; }
        @media (prefers-reduced-motion: reduce) { .crt-cursor,.blinkrect { animation:none } }
      `}</style>

      {/* ---------- title bar ---------- */}
      <div style={{ background: "#000", color: "#fff", textAlign: "center", fontWeight: 700, fontSize: 15,
        letterSpacing: 6, padding: "4px 0 7px", border: "2px solid #fff", borderBottom: "none" }}>
        W I P&nbsp;&nbsp;-&nbsp;&nbsp;P r o t o t y p e&nbsp;&nbsp;2 . 0
      </div>

      {/* ---------- window grid ---------- */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.62fr) minmax(0, 1fr)",
        gridTemplateRows: "minmax(0, 1.12fr) minmax(0, 1fr) 148px",
        gap: 4, background: "#000",
        border: "2px solid #fff", borderTop: "4px solid #000", outline: "2px solid #fff",
        padding: 4, height: "calc(100vh - 90px)", minHeight: 700,
      }}>
        {/* ---- Document Structure ---- */}
        <Pane label="Document Structure">
          <DocumentStructure nodes={nodes} hovered={hovered} selected={selected}
            presEnter={presEnter} presLeave={presLeave} presClick={presClick} presMenu={presMenu} />
        </Pane>

        {/* ---- Trace ---- */}
        <Pane label="Trace" style={{ gridRow: "1 / span 2", gridColumn: "2" }}>
          <div ref={traceRef} style={{ height: "100%", overflowY: "auto", padding: "3px 5px",
            fontSize: 10.5, lineHeight: "13px", whiteSpace: "pre" }}>
            {trace.map((l, i) => (
              <div key={i} style={{
                fontStyle: l.kind === "sched" ? "italic" : "normal",
                fontWeight: l.kind === "gd" || l.kind === "echo" || l.kind === "err" ? 700 : 400,
              }}>
                <TraceLine text={l.text} hovered={hovered}
                  presEnter={presEnter} presLeave={presLeave} presClick={presClick} presMenu={presMenu} />
              </div>
            ))}
            {!running && <span className="crt-cursor" />}
          </div>
        </Pane>

        {/* ---- Clipboard + TAG Results ---- */}
        <Pane label="Graphics Designer Clipboard">
          <div style={{ display: "flex", height: "100%" }}>
            <div style={{ flex: "1 1 52%", borderRight: "2px solid #000", minWidth: 0 }}>
              <EspressoMachine hotParts={hotParts} hovered={hovered}
                presEnter={presEnter} presLeave={presLeave} presClick={presClick} presMenu={presMenu} />
            </div>
            <div style={{ flex: "1 1 48%", display: "flex", flexDirection: "column", minWidth: 0 }}>
              <div style={{ flex: 1, padding: "4px 6px", fontSize: 11, lineHeight: "14px", overflow: "auto" }}>
                {!tag && <span style={{ fontStyle: "italic" }}>No annotation. Run a LOCALIZE plan.</span>}
                {tag && (
                  <>
                    <Pres pres={{ id: "annotation-1", label: `"${cap(tag.nl)}"`, type: "ANNOTATION",
                      pane: "TAG Results", form: `${cap(tag.nl)} (Annotation)` }}
                      hovered={hovered} enter={presEnter} leave={presLeave} click={presClick} menu={presMenu}>
                      {cap(tag.nl)} (Annotation)
                    </Pres>
                    <div>
                      The {tag.nl} is located in the picture .{" "}
                      {tag.words.map((w, i) => <span key={i}>{w} </span>)}
                    </div>
                    {tag.final && (
                      <div style={{ marginTop: 6 }}>
                        {"==> "}
                        <Pres pres={{ id: "utterance-1", label: `"${tag.final.slice(0, 34)}..."`,
                          type: "GENERATED-UTTERANCE", pane: "TAG Results", form: tag.final }}
                          hovered={hovered} enter={presEnter} leave={presLeave} click={presClick} menu={presMenu}>
                          {tag.final}
                        </Pres>
                      </div>
                    )}
                  </>
                )}
              </div>
              <PaneLabel>TAG Results</PaneLabel>
            </div>
          </div>
        </Pane>

        {/* ---- Lisp Listener ---- */}
        <Pane label="Lisp Listener" style={{ gridRow: "3", gridColumn: "1 / span 2" }}
          extra={
            <span style={{ fontWeight: 400, marginLeft: "auto", whiteSpace: "nowrap" }}>
              <span style={{ cursor: "pointer", fontWeight: 700 }}
                onClick={(e) => { e.stopPropagation(); setMenu(null);
                  setExMenu({ x: e.clientX - 160, y: e.clientY - 8 - PRESETS.length * 19 }); }}>
                [Examples ▾]
              </span>
              &nbsp;&nbsp;
              <span style={{ cursor: "pointer", fontWeight: 700 }}
                onClick={(e) => { e.stopPropagation(); runProgram(source); }}>
                [Run]
              </span>
              <span style={{ opacity: 0.7 }}>&nbsp; (Ctrl+Enter)</span>
            </span>
          }
        >
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runProgram(source); }
            }}
            spellCheck={false}
            style={{ width: "100%", height: "100%", border: "none", outline: "none", resize: "none",
              fontFamily: FONT, fontSize: 11.5, lineHeight: "14px", padding: "4px 6px",
              background: "#fff", color: "#000", userSelect: "text", boxSizing: "border-box" }}
          />
        </Pane>
      </div>

      {/* ---------- mouse documentation line ---------- */}
      <div style={{ marginTop: 4, background: "#000", color: "#fff", fontSize: 11, padding: "3px 8px 4px",
        border: "2px solid #fff", display: "flex", justifyContent: "space-between", gap: 12,
        whiteSpace: "nowrap", overflow: "hidden" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{mouseDoc}</span>
        <span style={{ flexShrink: 0 }}>
          WIP&nbsp; Tyler:&nbsp; {running ? "Run" : "User Input"}
        </span>
      </div>

      {/* ---------- presentation menu ---------- */}
      {menu && (
        <div onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 50, background: "#fff",
            border: "2px solid #000", boxShadow: "4px 4px 0 #000", fontSize: 11, minWidth: 190 }}>
          <div style={{ background: "#000", color: "#fff", padding: "2px 6px", fontWeight: 700, letterSpacing: 1 }}>
            {menu.pres.type}
          </div>
          {["Inspect", "Describe", "Copy Form"].map((a) => (
            <div key={a} className="menu-item" onClick={() => runMenuAction(a)}
              style={{ padding: "2px 6px", cursor: "pointer" }}>
              {a} {menu.pres.label.length > 22 ? menu.pres.label.slice(0, 22) + "…" : menu.pres.label}
            </div>
          ))}
        </div>
      )}

      {/* ---------- examples menu ---------- */}
      {exMenu && (
        <div onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: Math.max(8, exMenu.x), top: Math.max(8, exMenu.y), zIndex: 50,
            background: "#fff", border: "2px solid #000", boxShadow: "4px 4px 0 #000", fontSize: 11, minWidth: 230 }}>
          <div style={{ background: "#000", color: "#fff", padding: "2px 6px", fontWeight: 700, letterSpacing: 1 }}>
            PRESET PROGRAMS
          </div>
          {PRESETS.map((p) => (
            <div key={p.name} className="menu-item"
              onClick={() => { setSource(p.src); setExMenu(null); runProgram(p.src); }}
              style={{ padding: "2px 6px", cursor: "pointer" }}>
              {p.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ==================== 9. PANES & PRESENTATIONS ==================== */

function PaneLabel({ children, extra }) {
  return (
    <div style={{ borderTop: "2px solid #000", fontSize: 11.5, fontWeight: 700,
      padding: "2px 6px 3px", display: "flex", alignItems: "baseline" }}>
      <span className="hatch" style={{ width: 90, height: 8, marginRight: 8, border: "1px solid #000", flexShrink: 0 }} />
      {children}
      {extra}
    </div>
  );
}

function Pane({ label, children, style, extra }) {
  return (
    <div style={{ background: "#fff", border: "2px solid #000", display: "flex", minHeight: 0, minWidth: 0, ...style }}>
      <div className="hatch" style={{ width: 11, borderRight: "2px solid #000", flexShrink: 0, position: "relative" }}>
        <div style={{ position: "absolute", top: "12%", left: 1, right: 1, height: "34%",
          background: "#fff", border: "1px solid #000" }} />
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>{children}</div>
        <PaneLabel extra={extra}>{label}</PaneLabel>
      </div>
    </div>
  );
}

function Pres({ pres, hovered, enter, leave, click, menu, children }) {
  const hot = hovered === pres.id;
  return (
    <span
      onMouseEnter={() => enter(pres)}
      onMouseLeave={leave}
      onClick={(e) => { e.stopPropagation(); click(pres); }}
      onContextMenu={(e) => { e.stopPropagation(); menu(e, pres); }}
      style={{ cursor: "pointer", outline: hot ? "2px solid #000" : "2px solid transparent", outlineOffset: 1 }}
    >
      {children}
    </span>
  );
}

function TraceLine({ text, hovered, presEnter, presLeave, presClick, presMenu }) {
  const m = text.match(/TAG-Object "([a-z/]+)"/i);
  if (m) {
    const [before, after] = text.split(`"${m[1]}"`);
    const pres = { id: `tag-${m[1]}`, label: `TAG-Object "${m[1]}"`, type: "TAG-OBJECT", pane: "Trace", form: text };
    return (
      <>
        {before}
        <Pres pres={pres} hovered={hovered} enter={presEnter} leave={presLeave} click={presClick} menu={presMenu}>
          "{m[1]}"
        </Pres>
        {after}
      </>
    );
  }
  return <>{text}</>;
}

/* ==================== 10. DOCUMENT STRUCTURE (SVG) ==================== */

function DocumentStructure({ nodes, hovered, selected, presEnter, presLeave, presClick, presMenu }) {
  const laid = layoutNodes(nodes);
  const byId = Object.fromEntries(laid.map((n) => [n.id, n]));
  const w = Math.max(790, ...laid.map((n) => n.x + n.w + 24));
  const h = Math.max(470, ...laid.map((n) => n.y + n.h + 24));
  return (
    <div style={{ height: "100%", overflow: "auto" }}>
      {laid.length === 0 && (
        <div style={{ padding: 10, fontSize: 11, fontStyle: "italic" }}>
          The presentation plan will appear here.
        </div>
      )}
      <svg width={w} height={h} style={{ display: "block", fontFamily: FONT }}>
        {laid.filter((n) => n.parent && byId[n.parent]).map((n) => {
          const p = byId[n.parent];
          return (
            <line key={"e" + n.id} x1={p.x + p.w} y1={p.y + p.h / 2} x2={n.x} y2={n.y + n.h / 2}
              stroke="#000" strokeWidth={1} />
          );
        })}
        {laid.map((n) => {
          const hot = hovered === n.id, sel = selected === n.id;
          const pres = { id: n.id, label: n.lines[0] + " ...)", type: "PLAN-NODE",
            pane: "Document Structure", form: n.lines.join("\n") };
          return (
            <g key={n.id} style={{ cursor: "pointer" }}
              onMouseEnter={() => presEnter(pres)} onMouseLeave={presLeave}
              onClick={(e) => { e.stopPropagation(); presClick(pres); }}
              onContextMenu={(e) => presMenu(e, pres)}>
              {hot && <rect x={n.x - 3} y={n.y - 3} width={n.w + 6} height={n.h + 6}
                fill="none" stroke="#000" strokeWidth={2} />}
              <rect x={n.x} y={n.y} width={n.w} height={n.h}
                fill={sel ? "#000" : "#fff"} stroke="#000" strokeWidth={1} />
              {n.lines.map((l, i) => (
                <text key={i} x={n.x + PAD} y={n.y + PAD + (i + 1) * LH - 3}
                  fontSize={F} fill={sel ? "#fff" : "#000"} xmlSpace="preserve">
                  {l}
                </text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ==================== 11. THE CLIPBOARD DRAWING ==================== */

function PartG({ id, hotParts, hovered, presEnter, presLeave, presClick, presMenu, children }) {
  const part = PARTS[id];
  const pres = { id, label: `${id} (${part.nl})`, type: "GRAPHIC-OBJECT",
    pane: "Graphics Designer Clipboard",
    form: `#<GRAPHIC-OBJECT ${id} :DEPICTS ${part.typeSym} :IN PIC-13321>` };
  const hot = hovered === id;
  const marked = hotParts.has(id);
  const b = part.bbox;
  return (
    <g style={{ cursor: "pointer" }}
      onMouseEnter={() => presEnter(pres)} onMouseLeave={presLeave}
      onClick={(e) => { e.stopPropagation(); presClick(pres); }}
      onContextMenu={(e) => presMenu(e, pres)}>
      {(hot || marked) && (
        <rect className={marked && !hot ? "blinkrect" : undefined}
          x={b.x - 5} y={b.y - 5} width={b.w + 10} height={b.h + 10}
          fill="none" stroke="#000" strokeWidth={2}
          strokeDasharray={marked && !hot ? "3 2" : "0"} />
      )}
      {children}
    </g>
  );
}

function EspressoMachine(props) {
  const S = { stroke: "#000", strokeWidth: 1.3, fill: "#fff", strokeLinejoin: "round" };
  return (
    <svg viewBox="0 0 300 260" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
      style={{ display: "block" }}>
      <defs>
        <pattern id="knurl" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill="#fff" />
          <line x1="0" y1="0" x2="0" y2="4" stroke="#000" strokeWidth="1.4" />
        </pattern>
      </defs>
      {/* machine head (structural, not a named part) */}
      <g {...S}>
        <polygon points="30,42 232,42 258,24 56,24" />
        <polygon points="30,42 232,42 232,88 30,88" />
        <polygon points="232,42 258,24 258,70 232,88" />
        <circle cx="128" cy="65" r="10" />
        <circle cx="168" cy="65" r="10" />
      </g>
      {/* PORTHOLE-1: the brew gauge */}
      <PartG id="PORTHOLE-1" {...props}>
        <circle cx="66" cy="65" r="12" {...S} />
        <line x1="66" y1="65" x2="74" y2="58" {...S} />
      </PartG>
      {/* CONTAINER-1: the water container */}
      <PartG id="CONTAINER-1" {...props}>
        <polygon points="118,88 150,88 150,196 118,196" {...S} />
        <polygon points="150,88 162,80 162,188 150,196" {...S} />
      </PartG>
      {/* BASE-1: the drip tray */}
      <PartG id="BASE-1" {...props}>
        <polygon points="34,196 236,196 262,178 60,178" {...S} />
        <polygon points="34,196 236,196 236,222 34,222" {...S} />
        <polygon points="236,196 262,178 262,204 236,222" {...S} />
      </PartG>
      {/* SWITCH-2: the on/off switch */}
      <PartG id="SWITCH-2" {...props}>
        <rect x="194" y="88" width="24" height="26" fill="url(#knurl)" stroke="#000" strokeWidth="1.3" />
        <path d="M194,114 q12,8 24,0" fill="url(#knurl)" stroke="#000" strokeWidth="1.3" />
      </PartG>
    </svg>
  );
}

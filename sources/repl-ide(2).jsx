import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip,
} from "recharts";

/* =========================================================================
   PALETTE / TOKENS
   Structure (backgrounds, borders, chrome) stays monochrome. The 60s-palette
   accents are reserved for text foreground color only, per the brief.
========================================================================= */
const C = {
  paper: "#F3EFE3",
  paperDim: "#E7E0CC",
  ink: "#1C1B17",
  line: "#A39C86",
  mustard: "#A9791F",
  burnt: "#B5451B",
  teal: "#1F6F6F",
  olive: "#5B6E33",
  plum: "#6B3B4A",
};
const FONT_UI = 'Geneva, "Helvetica Neue", Helvetica, Arial, sans-serif';
const FONT_MONO = 'Monaco, Consolas, "Courier New", monospace';
const LINE_H = 20;
const PAD_V = 8;
const PAD_H = 10;

const CSS = `
* { box-sizing: border-box; }
.retro-root { font-family: ${FONT_UI}; }
.retro-btn {
  font-family: ${FONT_UI}; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase;
  border: 1px solid ${C.ink}; background: ${C.paper}; color: ${C.ink};
  padding: 6px 11px; border-radius: 4px; cursor: pointer; box-shadow: 2px 2px 0 ${C.ink};
}
.retro-btn:hover { background: ${C.paperDim}; }
.retro-btn:active { transform: translate(2px, 2px); box-shadow: none; }
.retro-btn:disabled { opacity: 0.4; cursor: default; box-shadow: none; transform: none; }
.retro-btn.inverted { background: ${C.ink}; color: ${C.paper}; }
.retro-btn.inverted:hover { background: #33322c; }
.retro-chip {
  font-family: ${FONT_MONO}; font-size: 11px; border: 1px solid ${C.ink}; border-radius: 3px;
  padding: 2px 7px; background: #fff; color: ${C.ink}; cursor: pointer;
}
.retro-chip:hover { background: ${C.paperDim}; }
.retro-tab {
  font-family: ${FONT_UI}; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase;
  padding: 5px 9px; border: 1px solid ${C.ink}; border-bottom: none; background: ${C.paperDim};
  color: ${C.ink}; cursor: pointer; margin-right: 2px;
}
.retro-tab.active { background: #fff; font-weight: bold; }
.stripe-bar {
  background-image: repeating-linear-gradient(45deg, ${C.ink} 0, ${C.ink} 1px, transparent 1px, transparent 5px);
  opacity: 0.85;
}
@keyframes flashCell { 0% { background: #A9791F33; } 100% { background: transparent; } }
.flash { animation: flashCell 900ms ease-out; }
textarea:focus-visible, .retro-btn:focus-visible, .retro-chip:focus-visible {
  outline: 2px solid ${C.teal}; outline-offset: 1px;
}
textarea { font: inherit; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: ${C.paperDim}; }
::-webkit-scrollbar-thumb { background: ${C.line}; border: 1px solid ${C.ink}; }
`;

/* =========================================================================
   MOCK BACKEND — mirrors the go-go-goja HTTP API shape:
   sessions CRUD, evaluate, history, bindings, docs, export, restore.
   Runs real JS via Function/AsyncFunction with a persistent-globals trick
   so top-level const/let/function survive across cells like a real REPL.
========================================================================= */

// depth-aware split into top-level statements (so `const x=40; x+2` on one
// line resolves correctly, while semicolons inside for(;;) are not split on)
function splitTopLevel(src) {
  const stmts = [];
  let i = 0, depth = 0, start = 0;
  const n = src.length;
  const pushIfNonEmpty = (s, e) => {
    const text = src.slice(s, e);
    if (text.trim().length > 0) stmts.push({ text, start: s, end: e });
  };
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { let j = i; while (j < n && src[j] !== "\n") j++; i = j; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'") { const q = c; i++; while (i < n && src[i] !== q) { if (src[i] === "\\") i++; i++; } i++; continue; }
    if (c === "`") { i++; while (i < n && src[i] !== "`") { if (src[i] === "\\") i++; i++; } i++; continue; }
    if (c === "{" || c === "(" || c === "[") { depth++; i++; continue; }
    if (c === "}" || c === ")" || c === "]") { depth = Math.max(0, depth - 1); i++; continue; }
    if (depth === 0 && (c === ";" || c === "\n")) {
      pushIfNonEmpty(start, i);
      i++;
      while (i < n && /[\s;]/.test(src[i])) i++;
      start = i;
      continue;
    }
    i++;
  }
  pushIfNonEmpty(start, n);
  return stmts;
}

// brace-depth aware scan for top-level const/let/var/function/class names
function scanTopLevelDecls(src) {
  const decls = [];
  let i = 0, depth = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { let j = i; while (j < n && src[j] !== "\n") j++; i = j; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'") { const q = c; i++; while (i < n && src[i] !== q) { if (src[i] === "\\") i++; i++; } i++; continue; }
    if (c === "`") { i++; while (i < n && src[i] !== "`") { if (src[i] === "\\") i++; i++; } i++; continue; }
    if (c === "{") { depth++; i++; continue; }
    if (c === "}") { depth = Math.max(0, depth - 1); i++; continue; }
    if (depth === 0) {
      const rest = src.slice(i);
      let m;
      if ((m = /^(?:const|let|var)\s+/.exec(rest))) {
        i += m[0].length;
        const idm = /^([a-zA-Z_$][\w$]*)/.exec(src.slice(i));
        if (idm) { decls.push(idm[1]); i += idm[1].length; }
        continue;
      }
      if ((m = /^function\s+([a-zA-Z_$][\w$]*)/.exec(rest))) { decls.push(m[1]); i += m[0].length; continue; }
      if ((m = /^class\s+([a-zA-Z_$][\w$]*)/.exec(rest))) { decls.push(m[1]); i += m[0].length; continue; }
    }
    i++;
  }
  return [...new Set(decls)];
}

function summarize(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "function") return "\u0192 " + (value.name || "anonymous") + "(" + value.length + ")";
  if (Array.isArray(value)) return "Array(" + value.length + ")";
  if (value instanceof Error) return value.name + ": " + value.message;
  if (typeof value === "object") return (value.constructor && value.constructor.name !== "Object") ? value.constructor.name : "Object{" + Object.keys(value).length + "}";
  return String(value);
}
function safeJSON(value) { try { return JSON.stringify(value); } catch (e) { return undefined; } }
function typeName(v) {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return "Array(" + v.length + ")";
  if (typeof v === "function") return "Function";
  if (typeof v === "object") return (v.constructor && v.constructor.name) || "Object";
  return typeof v;
}
function preview(v) {
  const s = summarize(v);
  return s.length > 48 ? s.slice(0, 45) + "..." : s;
}

const DOCS = [
  { name: "widget", signature: "widget(type, spec)", description: "Wrap a value as a custom rich-display widget." },
  { name: "table", signature: "table(rows)", description: "Render an array of objects as a table widget." },
  { name: "chart", signature: "chart(spec)", description: "Render a line/bar chart widget from {x,y} data." },
  { name: "html", signature: "html(raw)", description: "Render a raw HTML string in a sandboxed widget." },
  { name: "slider", signature: "slider(min, max, step?)", description: "Numeric control definition for interactive()." },
  { name: "interactive", signature: "interactive(controls, fn)", description: "Live widget: fn re-runs on control change." },
  { name: "console", signature: "console.log/warn/error/info", description: "Captured per cell, shown in Execution tab." },
];

const HELPER_NAMES = ["widget", "table", "chart", "html", "slider", "interactive", "console"];

class MockReplBackend {
  constructor() {
    this.sessions = new Map();
    this._nextSessionN = 1;
  }
  _delay(ms) { return new Promise((res) => setTimeout(res, ms)); }
  _newSessionState(profile) {
    const id = "sess-" + this._nextSessionN++;
    return {
      id, profile: profile || "default",
      createdAt: new Date().toISOString(),
      policy: { timeoutMs: 5000, maxConsoleEvents: 200 },
      globals: {}, bindingCellMap: {}, nextCellId: 0,
      cells: [], history: [], provenance: [],
      widgetHandlers: new Map(),
    };
  }
  _bindingViews(session) {
    return Object.entries(session.globals).map(([name, value]) => ({
      name, type: typeName(value), valuePreview: preview(value),
      updatedAtCell: session.bindingCellMap[name] != null ? session.bindingCellMap[name] : null,
    }));
  }
  _summarize(session) {
    return {
      id: session.id, profile: session.profile, policy: session.policy,
      createdAt: session.createdAt, cellCount: session.cells.length,
      bindingCount: Object.keys(session.globals).length,
      bindings: this._bindingViews(session),
      history: session.history.slice(-100),
      currentGlobals: this._bindingViews(session),
      provenance: session.provenance.slice(-100),
    };
  }
  async listSessions() {
    await this._delay(100);
    return [...this.sessions.values()].map((s) => this._summarize(s));
  }
  async createSession(profile) {
    await this._delay(140);
    const s = this._newSessionState(profile);
    this.sessions.set(s.id, s);
    return this._summarize(s);
  }
  async getSession(id) {
    await this._delay(60);
    const s = this.sessions.get(id);
    if (!s) throw new Error("session not found");
    return { summary: this._summarize(s), cells: s.cells.slice() };
  }
  async deleteSession(id) {
    await this._delay(90);
    this.sessions.delete(id);
  }
  async getHistory(id) {
    await this._delay(60);
    const s = this.sessions.get(id);
    return s ? s.history.slice() : [];
  }
  async getBindings(id) {
    await this._delay(60);
    const s = this.sessions.get(id);
    return s ? this._bindingViews(s) : [];
  }
  async getDocs() {
    await this._delay(50);
    return DOCS;
  }
  async exportSession(id) {
    await this._delay(140);
    const s = this.sessions.get(id);
    if (!s) throw new Error("session not found");
    return JSON.stringify({
      id: s.id, profile: s.profile, createdAt: s.createdAt,
      cells: s.cells.map((c) => ({ id: c.id, source: c.source, execution: c.execution, createdAt: c.createdAt })),
    }, null, 2);
  }
  async restoreSession(exportedJSON) {
    await this._delay(180);
    const data = JSON.parse(exportedJSON);
    const s = this._newSessionState(data.profile);
    this.sessions.set(s.id, s);
    for (const c of data.cells || []) {
      const report = await this._runCell(s, c.source);
      s.cells.push(report);
      s.history.push({ cellId: report.id, source: c.source, status: report.execution.status, createdAt: report.createdAt });
    }
    return this._summarize(s);
  }
  async evaluate(sessionId, source) {
    await this._delay(160 + Math.random() * 120);
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("session not found");
    const report = await this._runCell(session, source);
    session.cells.push(report);
    session.history.push({ cellId: report.id, source, status: report.execution.status, createdAt: report.createdAt });
    return { session: this._summarize(session), cell: report };
  }
  async sendWidgetEvent(sessionId, widgetRef, payload) {
    await this._delay(70);
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("session not found");
    const handler = session.widgetHandlers.get(widgetRef);
    if (!handler) throw new Error("widget expired");
    let rendered;
    try { rendered = await handler(payload); } catch (e) { rendered = "Error: " + ((e && e.message) || e); }
    return { rendered };
  }
  async _runCell(session, source) {
    const cellId = ++session.nextCellId;
    const createdAt = new Date().toISOString();
    const staticReport = {
      warnings: /\bvar\b/.test(source) ? ["uses var \u2014 prefer const/let"] : [],
      usesAwait: /\bawait\b/.test(source),
      usesConsole: /\bconsole\./.test(source),
    };
    const prevGlobals = { ...session.globals };
    const paramNames = Object.keys(session.globals);
    const paramValues = Object.values(session.globals);

    const consoleEvents = [];
    const fakeConsole = {
      log: (...a) => consoleEvents.push({ level: "log", args: a.map(String), timestamp: Date.now() }),
      warn: (...a) => consoleEvents.push({ level: "warn", args: a.map(String), timestamp: Date.now() }),
      error: (...a) => consoleEvents.push({ level: "error", args: a.map(String), timestamp: Date.now() }),
      info: (...a) => consoleEvents.push({ level: "info", args: a.map(String), timestamp: Date.now() }),
    };

    const widget = (type, spec) => ({ __replWidget: () => ({ type, summary: (spec && spec.summary) || type, views: (spec && spec.views) || [], explain: spec && spec.explain }) });
    const table = (rows) => widget("Table", { summary: "Table[" + rows.length + "]", views: [{ viewType: "table", label: "Table", data: { rows } }] });
    const chart = (spec) => widget("Chart", { summary: spec.label || "Chart", views: [{ viewType: "chart", label: spec.label || "Chart", data: spec }] });
    const html = (raw) => widget("Html", { summary: "Html", views: [{ viewType: "html", label: "HTML", data: raw }] });
    const slider = (min, max, step) => ({ kind: "slider", min, max, step: step || 1, value: (min + max) / 2 });
    const interactive = (controls, renderFn) => {
      const ref = "w-" + Math.random().toString(36).slice(2, 8);
      session.widgetHandlers.set(ref, renderFn);
      const initialParams = {};
      Object.entries(controls).forEach(([k, c]) => { initialParams[k] = c.value != null ? c.value : (c.min != null ? c.min : 0); });
      let initial; try { initial = renderFn(initialParams); } catch (e) { initial = String(e); }
      return widget("Interactive", { summary: "Manipulate[" + Object.keys(controls).join(", ") + "]", views: [{ viewType: "interactive", label: "Interactive", data: { controls, widgetRef: ref, params: initialParams, rendered: initial } }] });
    };
    const helperValues = [widget, table, chart, html, slider, interactive];

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const trimmed = source.trim();

    let status = "ok", errorMsg = "", out, rewrittenSource = "", usedPass = 1;
    const beforeWinKeys = (typeof window !== "undefined") ? new Set(Object.keys(window)) : null;
    const t0 = Date.now();

    let fn = null;
    const wholeBody = "return { __result: (\n" + trimmed + "\n), __locals: {} };";
    try { fn = new AsyncFunction(...paramNames, "console", ...HELPER_NAMES, wholeBody); }
    catch (e) { fn = null; }

    if (fn) {
      rewrittenSource = wholeBody;
      try { out = await fn(...paramValues, fakeConsole, ...helperValues); }
      catch (e) { status = "error"; errorMsg = String((e && e.message) || e); }
    } else {
      usedPass = 2;
      const decls = scanTopLevelDecls(trimmed);
      const stmtRe = /^(const|let|var|function|class|if|for|while|switch|try|throw|return|import|export|break|continue)\b/;
      const stmts = splitTopLevel(trimmed);
      let body2;
      if (stmts.length === 0) {
        body2 = "return { __result: undefined, __locals: { " + decls.join(", ") + " } };";
      } else {
        const lastStmt = stmts[stmts.length - 1];
        const before = trimmed.slice(0, lastStmt.start);
        let lastText = lastStmt.text.trim();
        if (lastText.endsWith(";")) lastText = lastText.slice(0, -1).trim();
        const isExprLast = lastText.length > 0 && !stmtRe.test(lastText) && !lastText.endsWith("{") && !lastText.endsWith("}");
        if (isExprLast) {
          body2 = before + "\nconst __result = (\n" + lastText + "\n);\nreturn { __result, __locals: { " + decls.join(", ") + " } };";
        } else {
          body2 = trimmed + "\nreturn { __result: undefined, __locals: { " + decls.join(", ") + " } };";
        }
      }
      rewrittenSource = body2;
      try {
        const fn2 = new AsyncFunction(...paramNames, "console", ...HELPER_NAMES, body2);
        out = await fn2(...paramValues, fakeConsole, ...helperValues);
      } catch (e) { status = "error"; errorMsg = String((e && e.message) || e); }
    }

    const locals = (out && out.__locals) || {};
    const resultValue = out ? out.__result : undefined;

    const newBindings = [], updatedBindings = [];
    Object.entries(locals).forEach(([k, v]) => {
      if (k in prevGlobals) updatedBindings.push(k); else newBindings.push(k);
      session.globals[k] = v; session.bindingCellMap[k] = cellId;
    });

    const durationMs = Date.now() - t0;
    let leakedGlobals = [];
    if (beforeWinKeys) {
      const afterWinKeys = Object.keys(window);
      leakedGlobals = afterWinKeys.filter((k) => !beforeWinKeys.has(k));
      leakedGlobals.forEach((k) => { try { delete window[k]; } catch (e) {} });
    }

    let widgetPayload = null;
    if (status === "ok") {
      if (resultValue && typeof resultValue.__replWidget === "function") widgetPayload = resultValue.__replWidget();
      else if (Array.isArray(resultValue) && resultValue.length > 0 && resultValue.every((v) => v && typeof v === "object" && !Array.isArray(v))) {
        widgetPayload = { type: "Array", summary: "Array[" + resultValue.length + "]", views: [{ viewType: "table", label: "Table", data: { rows: resultValue } }, { viewType: "json", label: "JSON", data: resultValue }] };
      }
    }

    const executionReport = {
      status, result: status === "ok" ? summarize(resultValue) : "", resultJson: status === "ok" ? safeJSON(resultValue) : undefined,
      error: errorMsg, durationMs, awaited: /\bawait\b/.test(source), console: consoleEvents,
      hadSideFX: consoleEvents.length > 0 || newBindings.length > 0 || updatedBindings.length > 0,
      helperError: false, widget: widgetPayload,
    };
    const provenanceThisCell = [
      ...newBindings.map((n) => ({ binding: n, cellId, kind: "created" })),
      ...updatedBindings.map((n) => ({ binding: n, cellId, kind: "updated" })),
    ];
    session.provenance.push(...provenanceThisCell);

    return {
      id: cellId, createdAt, source,
      static: staticReport,
      rewrite: { rewritten: true, pass: usedPass, originalSource: source, rewrittenSource, declaredNames: Object.keys(locals) },
      execution: executionReport,
      runtime: {
        newBindings, updatedBindings, removedBindings: [], leakedGlobals,
        persistedByWrap: Object.keys(session.globals), currentCellValue: executionReport.result,
      },
      provenance: provenanceThisCell,
    };
  }
}

/* =========================================================================
   TOKENIZERS (for syntax-highlighted display, JS and JSON)
========================================================================= */
const JS_KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "switch", "case",
  "break", "continue", "new", "class", "extends", "import", "export", "from", "default", "try",
  "catch", "finally", "throw", "typeof", "instanceof", "in", "of", "await", "async", "yield",
  "null", "undefined", "true", "false", "this", "super", "void", "delete", "do",
]);

function tokenizeJS(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { let j = i; while (j < n && src[j] !== "\n") j++; tokens.push({ type: "comment", text: src.slice(i, j) }); i = j; continue; }
    if (c === "/" && src[i + 1] === "*") { let j = i + 2; while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++; j = Math.min(n, j + 2); tokens.push({ type: "comment", text: src.slice(i, j) }); i = j; continue; }
    if (c === '"' || c === "'" || c === "`") { const q = c; let j = i + 1; while (j < n && src[j] !== q) { if (src[j] === "\\") j++; j++; } j = Math.min(n, j + 1); tokens.push({ type: "string", text: src.slice(i, j) }); i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i; while (j < n && /[0-9.eExXa-fA-F]/.test(src[j])) j++; tokens.push({ type: "number", text: src.slice(i, j) }); i = j; continue; }
    if (/[a-zA-Z_$]/.test(c)) { let j = i; while (j < n && /[a-zA-Z0-9_$]/.test(src[j])) j++; const word = src.slice(i, j); tokens.push({ type: JS_KEYWORDS.has(word) ? "keyword" : "ident", text: word }); i = j; continue; }
    if (/\s/.test(c)) { let j = i; while (j < n && /\s/.test(src[j])) j++; tokens.push({ type: "space", text: src.slice(i, j) }); i = j; continue; }
    tokens.push({ type: "punct", text: c }); i++;
  }
  return tokens;
}

function jsonTokens(text) {
  const re = /"(?:[^"\\]|\\.)*"|-?\d+\.?\d*(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/g;
  const out = [];
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: "plain", v: text.slice(last, m.index) });
    const v = m[0];
    let type = "plain";
    if (v[0] === '"') type = "string";
    else if (v === "true" || v === "false" || v === "null") type = "lit";
    else type = "number";
    out.push({ t: type, v });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ t: "plain", v: text.slice(last) });
  return out;
}

function CodeTokens({ code, bindings, onJump }) {
  const tokens = useMemo(() => tokenizeJS(code), [code]);
  return tokens.map((tok, i) => {
    if (tok.type === "keyword") return <span key={i} style={{ color: C.mustard }}>{tok.text}</span>;
    if (tok.type === "string") return <span key={i} style={{ color: C.olive }}>{tok.text}</span>;
    if (tok.type === "number") return <span key={i} style={{ color: C.teal }}>{tok.text}</span>;
    if (tok.type === "comment") return <span key={i} style={{ color: C.plum, fontStyle: "italic" }}>{tok.text}</span>;
    if (tok.type === "ident" && bindings && bindings[tok.text]) {
      const b = bindings[tok.text];
      return (
        <span
          key={i}
          style={{ color: C.teal, textDecoration: "underline", textDecorationStyle: "dotted", cursor: "pointer" }}
          onClick={() => onJump && onJump(b.updatedAtCell)}
          title={"defined in cell #" + b.updatedAtCell}
        >
          {tok.text}
        </span>
      );
    }
    return <React.Fragment key={i}>{tok.text}</React.Fragment>;
  });
}

/* =========================================================================
   SMALL UI PRIMITIVES
========================================================================= */
function Panel({ title, children }) {
  return (
    <div style={{ border: `1px solid ${C.ink}`, background: "#fff", marginBottom: 14 }}>
      <div className="stripe-bar" style={{ height: 4 }} />
      <div style={{ padding: "6px 9px", borderBottom: `1px solid ${C.line}`, fontFamily: FONT_UI, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: C.ink }}>
        {title}
      </div>
      <div style={{ padding: 9 }}>{children}</div>
    </div>
  );
}
function TagRow({ label, items, color }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: 4 }}>
      <span style={{ color: C.line }}>{label}: </span>
      {items.map((n, i) => <span key={i} style={{ color, marginRight: 8 }}>{n}</span>)}
    </div>
  );
}

/* =========================================================================
   CODE EDITOR (editable, syntax-highlighted overlay + line numbers + suggest)
========================================================================= */
function CodeEditor({ value, onChange, onRun, bindings, minRows, maxRows, gutter, onEnterRuns, placeholder }) {
  const rows = minRows || 3;
  const showGutter = gutter !== false;
  const taRef = useRef(null);
  const backdropRef = useRef(null);
  const [cursor, setCursor] = useState(value.length);
  const lines = value.length ? value.split("\n") : [""];
  const naturalRows = Math.max(rows, lines.length);
  const visualRows = maxRows ? Math.min(maxRows, naturalRows) : naturalRows;
  const capped = !!maxRows && naturalRows > maxRows;

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); onRun && onRun(); return; }
    if (onEnterRuns && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onRun && onRun(); return; }
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = taRef.current;
      if (!ta) return;
      const start = ta.selectionStart, end = ta.selectionEnd;
      const next = value.slice(0, start) + "  " + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; });
    }
  };
  const syncScroll = (e) => {
    if (backdropRef.current) { backdropRef.current.scrollLeft = e.target.scrollLeft; backdropRef.current.scrollTop = e.target.scrollTop; }
  };

  const prefix = useMemo(() => {
    const before = value.slice(0, cursor);
    const m = /[\w$]+$/.exec(before);
    return m ? m[0] : "";
  }, [value, cursor]);

  const candidates = useMemo(() => {
    if (!prefix) return [];
    const pool = new Set([...Object.keys(bindings || {}), ...HELPER_NAMES, ...JS_KEYWORDS]);
    return [...pool].filter((n) => n.startsWith(prefix) && n !== prefix).sort().slice(0, 6);
  }, [prefix, bindings]);

  const applySuggestion = (word) => {
    const ta = taRef.current;
    const start = cursor - prefix.length;
    const next = value.slice(0, start) + word + value.slice(cursor);
    onChange(next);
    const pos = start + word.length;
    requestAnimationFrame(() => { if (ta) { ta.selectionStart = ta.selectionEnd = pos; ta.focus(); } });
    setCursor(pos);
  };

  const sharedFont = {
    fontFamily: FONT_MONO, fontSize: 13, lineHeight: LINE_H + "px",
    whiteSpace: "pre", padding: PAD_V + "px " + PAD_H + "px",
  };
  const capStyle = capped ? { maxHeight: visualRows * LINE_H + PAD_V * 2, overflowY: "auto" } : { overflowY: "hidden" };

  return (
    <div>
      <div style={{ position: "relative", border: `1px solid ${C.ink}`, background: "#fff", display: "flex" }}>
        {showGutter && (
          <div style={{
            padding: PAD_V + "px 6px", textAlign: "right", borderRight: `1px solid ${C.line}`,
            background: C.paperDim, userSelect: "none", fontFamily: FONT_MONO, fontSize: 13,
            lineHeight: LINE_H + "px", color: C.line, minWidth: 32, ...capStyle,
          }}>
            {Array.from({ length: naturalRows }).map((_, i) => (
              <div key={i}>{i < lines.length ? i + 1 : ""}</div>
            ))}
          </div>
        )}
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <pre
            ref={backdropRef}
            aria-hidden="true"
            style={{ ...sharedFont, ...capStyle, margin: 0, overflowX: "auto", pointerEvents: "none", color: C.ink, minHeight: visualRows * LINE_H + PAD_V * 2 }}
          >
            <CodeTokens code={value} bindings={bindings} />
          </pre>
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => { onChange(e.target.value); setCursor(e.target.selectionStart); }}
            onClick={(e) => setCursor(e.target.selectionStart)}
            onKeyUp={(e) => setCursor(e.target.selectionStart)}
            onKeyDown={handleKeyDown}
            onScroll={syncScroll}
            spellCheck={false}
            placeholder={placeholder}
            style={{
              ...sharedFont, ...capStyle, position: "absolute", inset: 0, width: "100%", height: "100%",
              resize: "none", border: "none", background: "transparent", color: "transparent",
              caretColor: C.ink, overflowX: "auto", outline: "none",
            }}
          />
        </div>
      </div>
      {candidates.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, letterSpacing: "0.05em", color: C.line, textTransform: "uppercase" }}>suggest</span>
          {candidates.map((c) => (
            <button key={c} className="retro-chip" onClick={() => applySuggestion(c)}>{c}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   WIDGET RENDERING (viewType catalogue)
========================================================================= */
function PreBlock({ children }) {
  return <pre style={{ margin: 0, fontFamily: FONT_MONO, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{children}</pre>;
}
function JsonBlock({ data }) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const tokens = useMemo(() => jsonTokens(text), [text]);
  return (
    <pre style={{ margin: 0, fontFamily: FONT_MONO, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 260, overflow: "auto" }}>
      {tokens.map((t, i) => {
        if (t.t === "string") return <span key={i} style={{ color: C.olive }}>{t.v}</span>;
        if (t.t === "number") return <span key={i} style={{ color: C.teal }}>{t.v}</span>;
        if (t.t === "lit") return <span key={i} style={{ color: C.burnt }}>{t.v}</span>;
        return <React.Fragment key={i}>{t.v}</React.Fragment>;
      })}
    </pre>
  );
}
function formatCell(v) {
  if (v === null) return "null";
  if (v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function TableBlock({ rows }) {
  if (!rows || rows.length === 0) return <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.line }}>(empty)</div>;
  const cols = Object.keys(rows[0]);
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontFamily: FONT_MONO, fontSize: 12, width: "100%" }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} style={{ textAlign: "left", borderBottom: `1px solid ${C.ink}`, padding: "4px 8px", color: C.mustard, textTransform: "uppercase", fontSize: 10, letterSpacing: "0.04em" }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((r, i) => (
            <tr key={i} style={{ background: i % 2 ? C.paperDim : "transparent" }}>
              {cols.map((c) => <td key={c} style={{ padding: "4px 8px", borderBottom: `1px solid ${C.paperDim}` }}>{formatCell(r[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function ChartBlock({ spec }) {
  const data = spec.data || [];
  const isBar = spec.type === "bar";
  const tickStyle = { fontFamily: FONT_MONO, fontSize: 10, fill: C.ink };
  return (
    <div style={{ border: `1px solid ${C.line}`, padding: 8 }}>
      <ResponsiveContainer width="100%" height={200}>
        {isBar ? (
          <BarChart data={data}>
            <CartesianGrid stroke={C.paperDim} />
            <XAxis dataKey="x" tick={tickStyle} stroke={C.line} />
            <YAxis tick={tickStyle} stroke={C.line} />
            <Tooltip contentStyle={{ fontFamily: FONT_MONO, fontSize: 11, border: `1px solid ${C.ink}`, borderRadius: 0 }} />
            <Bar dataKey="y" fill={C.teal} />
          </BarChart>
        ) : (
          <LineChart data={data}>
            <CartesianGrid stroke={C.paperDim} />
            <XAxis dataKey="x" tick={tickStyle} stroke={C.line} />
            <YAxis tick={tickStyle} stroke={C.line} />
            <Tooltip contentStyle={{ fontFamily: FONT_MONO, fontSize: 11, border: `1px solid ${C.ink}`, borderRadius: 0 }} />
            <Line type="monotone" dataKey="y" stroke={C.teal} strokeWidth={2} dot={{ r: 3, fill: C.teal }} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
function InteractiveBlock({ data, sessionId, backend }) {
  const [params, setParams] = useState(data.params);
  const [rendered, setRendered] = useState(data.rendered);
  const [busy, setBusy] = useState(false);
  const handleChange = async (key, value) => {
    const next = { ...params, [key]: value };
    setParams(next);
    setBusy(true);
    try {
      const res = await backend.sendWidgetEvent(sessionId, data.widgetRef, next);
      setRendered(res.rendered);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: 8, border: `1px solid ${C.ink}` }}>
        {Object.entries(data.controls).map(([key, ctrl]) => (
          <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: FONT_MONO, fontSize: 12 }}>
            <span style={{ color: C.mustard }}>{key} =</span>
            <input type="range" min={ctrl.min} max={ctrl.max} step={ctrl.step} value={params[key]} onChange={(e) => handleChange(key, Number(e.target.value))} />
            <span style={{ color: C.teal, minWidth: 24, textAlign: "right" }}>{params[key]}</span>
          </label>
        ))}
      </div>
      <div style={{ marginTop: 6, fontFamily: FONT_MONO, fontSize: 13, padding: 8, border: `1px solid ${C.line}` }}>
        {busy ? "\u2026" : JSON.stringify(rendered)}
      </div>
    </div>
  );
}
function ViewRenderer({ view, sessionId, backend }) {
  if (!view) return null;
  if (view.viewType === "text") return <PreBlock>{String(view.data)}</PreBlock>;
  if (view.viewType === "json") return <JsonBlock data={view.data} />;
  if (view.viewType === "table") return <TableBlock rows={view.data.rows} />;
  if (view.viewType === "chart") return <ChartBlock spec={view.data} />;
  if (view.viewType === "html") return <div style={{ border: `1px solid ${C.ink}`, padding: 8 }} dangerouslySetInnerHTML={{ __html: view.data }} />;
  if (view.viewType === "interactive") return <InteractiveBlock data={view.data} sessionId={sessionId} backend={backend} />;
  return <JsonBlock data={view.data} />;
}
function WidgetPanel({ widget, sessionId, backend }) {
  const [activeView, setActiveView] = useState(0);
  if (!widget) return null;
  const views = widget.views || [];
  if (views.length === 0) return null;
  const view = views[activeView] || views[0];
  return (
    <div>
      {views.length > 1 && (
        <div style={{ display: "flex", gap: 4, marginBottom: 6, flexWrap: "wrap" }}>
          {views.map((v, i) => (
            <button
              key={i}
              className="retro-chip"
              style={i === activeView ? { background: C.ink, color: C.paper } : undefined}
              onClick={() => setActiveView(i)}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
      <ViewRenderer view={view} sessionId={sessionId} backend={backend} />
    </div>
  );
}

/* =========================================================================
   CELL CARD — five-tab report per evaluation (Static/Rewrite/Execution/
   Runtime/Provenance), matching the CellReport DTO shape.
========================================================================= */
const TAB_LABELS = { execution: "Execution", static: "Static", rewrite: "Rewrite", runtime: "Runtime", provenance: "Provenance" };

function ExecutionTab({ report, sessionId, backend }) {
  return (
    <div>
      {report.status === "error" ? (
        <div style={{ color: C.burnt, fontFamily: FONT_MONO, fontSize: 12, whiteSpace: "pre-wrap" }}>{report.error}</div>
      ) : (
        <div style={{ fontFamily: FONT_MONO, fontSize: 13, marginBottom: report.widget ? 8 : 0 }}>
          <span style={{ color: C.line }}>{"=> "}</span>{report.result}
        </div>
      )}
      {report.widget && <div style={{ marginTop: 8 }}><WidgetPanel widget={report.widget} sessionId={sessionId} backend={backend} /></div>}
      {report.console.length > 0 && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: C.line, marginBottom: 4 }}>Console</div>
          {report.console.map((ev, i) => (
            <div key={i} style={{ fontFamily: FONT_MONO, fontSize: 12, color: ev.level === "error" ? C.burnt : ev.level === "warn" ? C.mustard : C.ink }}>
              {ev.args.join(" ")}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function StaticTab({ report }) {
  return (
    <div style={{ fontFamily: FONT_MONO, fontSize: 12 }}>
      <div>usesAwait: <b style={{ color: report.usesAwait ? C.olive : C.line }}>{String(report.usesAwait)}</b></div>
      <div>usesConsole: <b style={{ color: report.usesConsole ? C.olive : C.line }}>{String(report.usesConsole)}</b></div>
      {report.warnings.length === 0
        ? <div style={{ color: C.line, marginTop: 6 }}>no warnings</div>
        : report.warnings.map((w, i) => <div key={i} style={{ color: C.burnt, marginTop: 4 }}>{"\u2022 " + w}</div>)}
    </div>
  );
}
function RewriteTab({ report }) {
  return (
    <div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.line, marginBottom: 6 }}>
        {"pass " + report.pass + " \u00b7 declared: " + (report.declaredNames.length ? report.declaredNames.join(", ") : "(none)")}
      </div>
      <pre style={{ margin: 0, fontFamily: FONT_MONO, fontSize: 11, whiteSpace: "pre-wrap", background: C.paperDim, padding: 8, border: `1px solid ${C.line}`, maxHeight: 180, overflow: "auto" }}>
        {report.rewrittenSource}
      </pre>
    </div>
  );
}
function RuntimeTab({ report }) {
  return (
    <div style={{ fontFamily: FONT_MONO, fontSize: 12 }}>
      <TagRow label="new" items={report.newBindings} color={C.olive} />
      <TagRow label="updated" items={report.updatedBindings} color={C.mustard} />
      <TagRow label="leaked" items={report.leakedGlobals} color={C.burnt} />
      <div style={{ marginTop: 6, color: C.line }}>persisted: {report.persistedByWrap.join(", ") || "(none)"}</div>
    </div>
  );
}
function ProvenanceTab({ items }) {
  if (!items || items.length === 0) return <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.line }}>no bindings produced this cell</div>;
  return (
    <div style={{ fontFamily: FONT_MONO, fontSize: 12 }}>
      {items.map((p, i) => (
        <div key={i}><span style={{ color: C.teal }}>{p.binding}</span> <span style={{ color: C.line }}>{p.kind} in cell #{p.cellId}</span></div>
      ))}
    </div>
  );
}
const DETAIL_TABS = ["static", "rewrite", "runtime", "provenance"];

function ConsoleEntry({ cell, bindings, onJump, sessionId, backend }) {
  const [expanded, setExpanded] = useState(false);
  const [detailTab, setDetailTab] = useState("static");
  const ok = cell.execution.status === "ok";
  return (
    <div id={"cell-" + cell.id} style={{ marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${C.paperDim}` }}>
      <div style={{ display: "flex", gap: 8 }}>
        <span style={{ color: ok ? C.line : C.burnt, fontFamily: FONT_MONO, fontSize: 13, lineHeight: LINE_H + "px", userSelect: "none" }}>{"\u203A"}</span>
        <pre style={{ margin: 0, flex: 1, fontFamily: FONT_MONO, fontSize: 13, lineHeight: LINE_H + "px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          <CodeTokens code={cell.source} bindings={bindings} onJump={onJump} />
        </pre>
      </div>
      <div style={{ marginLeft: 21 }}>
        <ExecutionTab report={cell.execution} sessionId={sessionId} backend={backend} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.line }}>{"#" + cell.id + " \u00b7 " + cell.execution.durationMs + "ms"}</span>
          <button className="retro-chip" style={{ fontSize: 10, padding: "1px 6px" }} onClick={() => setExpanded((v) => !v)}>
            {expanded ? "hide details" : "details"}
          </button>
        </div>
        {expanded && (
          <div style={{ marginTop: 8, border: `1px solid ${C.ink}`, background: "#fff" }}>
            <div style={{ display: "flex", gap: 0, padding: "6px 10px 0", flexWrap: "wrap" }}>
              {DETAIL_TABS.map((t) => (
                <button key={t} className={"retro-tab" + (detailTab === t ? " active" : "")} onClick={() => setDetailTab(t)}>{TAB_LABELS[t]}</button>
              ))}
            </div>
            <div style={{ padding: 10 }}>
              {detailTab === "static" && <StaticTab report={cell.static} />}
              {detailTab === "rewrite" && <RewriteTab report={cell.rewrite} />}
              {detailTab === "runtime" && <RuntimeTab report={cell.runtime} />}
              {detailTab === "provenance" && <ProvenanceTab items={cell.provenance} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   SIDEBAR PANELS
========================================================================= */
function SessionsPanel({ sessions, activeId, onSelect, onCreate, onDelete }) {
  return (
    <Panel title="Sessions">
      <div style={{ maxHeight: 150, overflowY: "auto" }}>
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            style={{
              padding: "5px 8px", cursor: "pointer", fontFamily: FONT_MONO, fontSize: 12,
              display: "flex", justifyContent: "space-between",
              background: s.id === activeId ? C.ink : "transparent",
              color: s.id === activeId ? C.paper : C.ink,
            }}
          >
            <span>{s.id}</span>
            <span style={{ opacity: 0.75 }}>{s.cellCount}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button className="retro-btn" onClick={onCreate}>+ new</button>
        <button className="retro-btn" onClick={onDelete} disabled={sessions.length <= 1}>delete</button>
      </div>
    </Panel>
  );
}
function BindingsPanel({ bindings, onJump }) {
  return (
    <Panel title="Bindings">
      <div style={{ maxHeight: 210, overflowY: "auto" }}>
        {bindings.length === 0 && <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.line }}>(none yet)</div>}
        {bindings.map((b) => (
          <div
            key={b.name}
            onClick={() => onJump(b.updatedAtCell)}
            style={{ padding: "3px 0", cursor: "pointer", fontFamily: FONT_MONO, fontSize: 11, borderBottom: `1px solid ${C.paperDim}` }}
          >
            <span style={{ color: C.teal }}>{b.name}</span>{" "}
            <span style={{ color: C.mustard }}>{b.type}</span>
            <div style={{ color: C.line, fontSize: 10 }}>{b.valuePreview}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
function ReferencePanel({ docs }) {
  return (
    <Panel title="Reference">
      <div style={{ maxHeight: 190, overflowY: "auto" }}>
        {docs.map((d) => (
          <div key={d.name} style={{ marginBottom: 7 }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.plum }}>{d.signature}</div>
            <div style={{ fontFamily: FONT_UI, fontSize: 10, color: C.line }}>{d.description}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* =========================================================================
   STATUS STRIP
========================================================================= */
function StatusStrip({ session, onExport, onRestore }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 12px", border: `1px solid ${C.ink}`, background: "#fff", flexWrap: "wrap" }}>
        <span style={{ fontFamily: FONT_UI, fontSize: 12, letterSpacing: "0.06em", fontWeight: "bold" }}>REPL</span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.line }}>{session ? session.id : "\u2014"}</span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.line }}>{session ? session.cellCount + " cells" : ""}</span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.line }}>{session ? session.bindingCount + " bindings" : ""}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button className="retro-btn" onClick={onExport}>export</button>
          <button className="retro-btn" onClick={onRestore}>restore</button>
        </div>
      </div>
      <div className="stripe-bar" style={{ height: 4 }} />
    </div>
  );
}

/* =========================================================================
   APP
========================================================================= */
const SEED_CELLS = [
  "const x = 40; x + 2",
  "const users = [\n  { name: \"Ada Lovelace\", role: \"Mathematician\" },\n  { name: \"Grace Hopper\", role: \"Rear Admiral\" },\n  { name: \"Margaret Hamilton\", role: \"Engineer\" }\n]; users",
  "const trend = chart({ label: \"n\u00b2\", type: \"line\",\n  data: [0,1,2,3,4,5,6].map(n => ({ x: n, y: n*n })) }); trend",
  "function fib(n){ return n < 2 ? n : fib(n-1) + fib(n-2); }\nconsole.log(\"fib(10) =\", fib(10)); fib(10)",
  "const zoom = interactive({ a: slider(0, 10, 1) }, ({ a }) => a * a); zoom",
  "JSON.parse(\"{not valid json}\")",
];

export default function App() {
  const backendRef = useRef(null);
  if (!backendRef.current) backendRef.current = new MockReplBackend();
  const backend = backendRef.current;

  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [docs, setDocs] = useState([]);
  const [editorValue, setEditorValue] = useState("");
  const [consoleValue, setConsoleValue] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [exportText, setExportText] = useState("");
  const [showRestore, setShowRestore] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [ready, setReady] = useState(false);
  const consoleScrollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function seed() {
      const s = await backend.createSession("default");
      for (const src of SEED_CELLS) {
        if (cancelled) return;
        await backend.evaluate(s.id, src);
      }
      if (cancelled) return;
      const full = await backend.getSession(s.id);
      const docsRes = await backend.getDocs();
      const allSessions = await backend.listSessions();
      if (cancelled) return;
      setSessions(allSessions);
      setActiveId(s.id);
      setDetail(full);
      setDocs(docsRes);
      setReady(true);
    }
    seed();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (consoleScrollRef.current) consoleScrollRef.current.scrollTop = consoleScrollRef.current.scrollHeight;
  }, [detail ? detail.cells.length : 0]);

  const handleSelectSession = useCallback(async (sid) => {
    setActiveId(sid);
    const full = await backend.getSession(sid);
    setDetail(full);
  }, [backend]);

  const handleCreateSession = useCallback(async () => {
    const s = await backend.createSession("default");
    setSessions(await backend.listSessions());
    setActiveId(s.id);
    setDetail({ summary: s, cells: [] });
  }, [backend]);

  const handleDeleteSession = useCallback(async () => {
    if (sessions.length <= 1 || !activeId) return;
    if (typeof window !== "undefined" && !window.confirm("Delete session " + activeId + "? This cannot be undone.")) return;
    await backend.deleteSession(activeId);
    const remaining = await backend.listSessions();
    setSessions(remaining);
    const next = remaining[0];
    if (next) {
      setActiveId(next.id);
      setDetail(await backend.getSession(next.id));
    }
  }, [backend, activeId, sessions]);

  const runCode = useCallback(async (source, onDone) => {
    if (!source.trim() || running || !activeId) return;
    setRunning(true);
    setRunError("");
    try {
      const { session, cell } = await backend.evaluate(activeId, source);
      setDetail((prev) => ({ summary: session, cells: [...(prev ? prev.cells : []), cell] }));
      setSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)));
      onDone && onDone();
    } catch (e) {
      setRunError(String((e && e.message) || e));
    } finally {
      setRunning(false);
    }
  }, [backend, activeId, running]);

  const handleRunEditor = useCallback(() => { runCode(editorValue); }, [runCode, editorValue]);
  const handleRunConsole = useCallback(() => { runCode(consoleValue, () => setConsoleValue("")); }, [runCode, consoleValue]);

  const handleExport = useCallback(async () => {
    if (!activeId) return;
    const text = await backend.exportSession(activeId);
    setExportText(text);
    setShowExport(true);
    setShowRestore(false);
  }, [backend, activeId]);

  const handleToggleRestore = useCallback(() => {
    setShowRestore((v) => !v);
    setShowExport(false);
  }, []);

  const handleRestoreSubmit = useCallback(async () => {
    setRestoreError("");
    try {
      const summary = await backend.restoreSession(restoreText);
      setSessions(await backend.listSessions());
      setActiveId(summary.id);
      setDetail(await backend.getSession(summary.id));
      setShowRestore(false);
      setRestoreText("");
    } catch (e) {
      setRestoreError("Could not restore: " + ((e && e.message) || e));
    }
  }, [backend, restoreText]);

  const onJump = useCallback((cellId) => {
    if (cellId == null) return;
    const el = document.getElementById("cell-" + cellId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }, []);

  const bindingsMap = useMemo(() => {
    if (!detail) return {};
    return Object.fromEntries(detail.summary.bindings.map((b) => [b.name, b]));
  }, [detail]);

  const historyChips = detail ? detail.summary.history : [];

  return (
    <div className="retro-root" style={{ color: C.ink, background: C.paper, padding: 16, maxWidth: 1180, margin: "0 auto" }}>
      <style>{CSS}</style>
      <StatusStrip session={detail ? detail.summary : null} onExport={handleExport} onRestore={handleToggleRestore} />

      {showExport && (
        <div style={{ border: `1px solid ${C.ink}`, borderTop: "none", padding: 10, background: "#fff" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: C.line, marginBottom: 6 }}>exported session json</div>
          <textarea readOnly value={exportText} style={{ width: "100%", height: 140, fontFamily: FONT_MONO, fontSize: 11, border: `1px solid ${C.line}`, padding: 6 }} />
        </div>
      )}
      {showRestore && (
        <div style={{ border: `1px solid ${C.ink}`, borderTop: "none", padding: 10, background: "#fff" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: C.line, marginBottom: 6 }}>paste exported session json</div>
          <textarea value={restoreText} onChange={(e) => setRestoreText(e.target.value)} style={{ width: "100%", height: 100, fontFamily: FONT_MONO, fontSize: 11, border: `1px solid ${C.line}`, padding: 6 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="retro-btn" onClick={handleRestoreSubmit}>restore session</button>
            {restoreError && <span style={{ color: C.burnt, fontSize: 11, fontFamily: FONT_MONO }}>{restoreError}</span>}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 16, marginTop: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 220px", maxWidth: 260 }}>
          <SessionsPanel sessions={sessions} activeId={activeId} onSelect={handleSelectSession} onCreate={handleCreateSession} onDelete={handleDeleteSession} />
          <BindingsPanel bindings={detail ? detail.summary.bindings : []} onJump={onJump} />
          <ReferencePanel docs={docs} />
        </div>

        <div style={{ flex: "3 1 460px", minWidth: 300 }}>
          <Panel title="Editor">
            <CodeEditor value={editorValue} onChange={setEditorValue} onRun={handleRunEditor} bindings={bindingsMap} minRows={7} gutter placeholder={"write code here \u2014 it stays put after you run it (\u2318\u21b5)"} />
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="retro-btn inverted" onClick={handleRunEditor} disabled={running || !editorValue.trim() || !ready}>
                {running ? "running\u2026" : "run \u25b6"}
              </button>
              <button className="retro-btn" onClick={() => setEditorValue("")}>clear</button>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.line }}>{"\u2318\u21b5 to run"}</span>
              {runError && <span style={{ color: C.burnt, fontSize: 11, fontFamily: FONT_MONO }}>{runError}</span>}
            </div>
          </Panel>

          <Panel title="Console">
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontFamily: FONT_UI, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: C.line }}>jump to</span>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {historyChips.map((h) => (
                  <button key={h.cellId} className="retro-chip" style={{ color: h.status === "ok" ? C.olive : C.burnt }} onClick={() => onJump(h.cellId)}>
                    {h.cellId}
                  </button>
                ))}
              </div>
            </div>
            <div ref={consoleScrollRef} style={{ maxHeight: 380, overflowY: "auto", paddingRight: 4, borderTop: `1px solid ${C.ink}`, borderBottom: `1px solid ${C.ink}`, padding: "8px 4px" }}>
              {!ready && <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.line }}>booting session\u2026</div>}
              {detail && detail.cells.map((cell) => (
                <ConsoleEntry key={cell.id} cell={cell} bindings={bindingsMap} onJump={onJump} sessionId={activeId} backend={backend} />
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <CodeEditor value={consoleValue} onChange={setConsoleValue} onRun={handleRunConsole} bindings={bindingsMap} minRows={1} maxRows={8} gutter={false} onEnterRuns placeholder={"type an expression \u2014 enter to run, shift+enter for newline"} />
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button className="retro-btn inverted" onClick={handleRunConsole} disabled={running || !consoleValue.trim() || !ready}>
                  {running ? "running\u2026" : "run \u25b6"}
                </button>
                <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.line }}>{"\u21b5 to run, shift+\u21b5 for newline"}</span>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

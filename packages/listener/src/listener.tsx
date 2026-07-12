/* The Listener: scrolling transcript of output records + a prompt line that
 * morphs between idle command line, typed-argument input, and
 * "accepting TYPE (point at a highlighted object)" banner. */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Presentation, useEngine, useEngineState, useTranscript } from "@pbui/react";
import { PartView } from "./parts.js";

export function Listener(props: {
  prompt?: string;
  className?: string;
  /** rows of transcript area; the pane scrolls internally */
  style?: React.CSSProperties;
}) {
  const engine = useEngine();
  useEngineState();
  const lines = useTranscript();
  // re-render when invocations change so echo lines become menuable
  useSyncExternalStore(
    (fn) => engine.invocations.subscribe(fn),
    () => engine.invocations.list(),
    () => engine.invocations.list(),
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState("");
  // Up/Down input history (Genera listener behavior): ring of submitted
  // lines; Down past the newest restores the unsent draft
  const history = useRef<string[]>([]);
  const histIdx = useRef<number | null>(null);
  const draft = useRef("");

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const info = engine.promptInfo();

  // pull focus when a typed argument is wanted
  useEffect(() => {
    if (info.accepting && info.typedInput) inputRef.current?.focus();
  }, [info.accepting, info.typedInput, info.spec?.name]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const consumed = engine.submitTyped(text);
      if (consumed) {
        if (text.trim()) {
          history.current.push(text);
          if (history.current.length > 50) history.current.shift();
        }
        histIdx.current = null;
        setText("");
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const h = history.current;
      if (!h.length) return;
      if (histIdx.current === null) {
        draft.current = text;
        histIdx.current = h.length - 1;
      } else if (histIdx.current > 0) {
        histIdx.current -= 1;
      }
      setText(h[histIdx.current]!);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const h = history.current;
      if (histIdx.current === null) return;
      if (histIdx.current < h.length - 1) {
        histIdx.current += 1;
        setText(h[histIdx.current]!);
      } else {
        histIdx.current = null;
        setText(draft.current);
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (!info.accepting) {
        const comps = engine.completions(text);
        if (comps.length === 1) setText(comps[0]! + " ");
        else if (comps.length > 1)
          engine.print(`Completions: ${comps.join(", ")}`);
      }
    }
  };

  const promptLabel = (() => {
    if (!info.accepting) return props.prompt ?? "> ";
    const filled = info.filled.map((f) => `(${f.name}: ${f.label})`).join(" ");
    const head = info.cmdName ? `${info.cmdName} ` : "";
    const dflt = info.defaultLabel ? ` [default ${info.defaultLabel}]` : "";
    const wanted = info.spec ? `(${info.spec.name}: a ${info.spec.type.toUpperCase()}${dflt})` : "";
    return `${head}${filled}${filled ? " " : ""}${wanted} ⇒ `;
  })();

  const lastLineText = lines.length
    ? lines[lines.length - 1]!.parts
        .map((p) => ("s" in p ? p.s : p.label))
        .join("")
    : "";

  return (
    <div className={`pbui-listener${props.className ? " " + props.className : ""}`} style={props.style}>
      {/* screen readers hear the newest output only, not the scrollback */}
      <div
        aria-live="polite"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}
      >
        {lastLineText}
      </div>
      <div className="pbui-listener-scroll" ref={scrollRef} onClick={() => inputRef.current?.focus()}>
        {lines.map((l) => {
          const inv = engine.invocations.byEchoLine(l.id);
          const body = l.parts.map((p, i) => <PartView key={i} part={p} />);
          if (inv) {
            // command history is made of presentations: right-click a past
            // command's echo line for Undo Invocation / Describe (quiet:
            // no hover flash over transcript text)
            return (
              <Presentation
                key={l.id}
                type="invocation"
                object={{ kind: "invocation", id: inv.id }}
                label={inv.name}
                quiet
                block
                className={`pbui-line pbui-line-${l.kind}`}
              >
                {body}
              </Presentation>
            );
          }
          return (
            <div key={l.id} className={`pbui-line pbui-line-${l.kind}`}>
              {body}
            </div>
          );
        })}
        <div className="pbui-prompt-line">
          <span className="pbui-prompt-label">{promptLabel}</span>
          <input
            ref={inputRef}
            className="pbui-prompt-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            aria-label="listener input"
          />
          {info.accepting && !info.typedInput && (
            <span className="pbui-prompt-hint">
              (point at a highlighted {info.spec?.type.toUpperCase()})
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

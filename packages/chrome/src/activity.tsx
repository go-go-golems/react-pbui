/* ActivityPane: the invocation log as a list of live INVOCATION
 * presentations — command history you can right-click (Undo Invocation,
 * Describe). Mount it anywhere; requires installUndoCommands(engine). */

import { useSyncExternalStore } from "react";
import type { CommandInvocation, InvocationStatus } from "@go-go-golems/pbui-core";
import { Presentation, useEngine } from "@go-go-golems/pbui-react";
import { Pane } from "./pane.js";

const GLYPH: Record<InvocationStatus, string> = {
  executing: "…",
  completed: "✓",
  failed: "✕",
  undone: "↩",
};

export function ActivityPane(props: { title?: string; limit?: number }) {
  const engine = useEngine();
  const invocations = useSyncExternalStore(
    (fn) => engine.invocations.subscribe(fn),
    () => engine.invocations.list(),
    () => engine.invocations.list(),
  );
  const rows = invocations.slice(-(props.limit ?? 20)).reverse();
  return (
    <Pane title={props.title ?? "Activity"} subtitle="right-click an entry — Undo Invocation">
      {rows.length === 0 && <div style={{ fontStyle: "italic", opacity: 0.7 }}>no commands yet</div>}
      {rows.map((inv: CommandInvocation) => (
        <div key={inv.id} style={{ padding: "1px 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          <span style={{ display: "inline-block", width: 16 }}>{GLYPH[inv.status]}</span>
          <Presentation type="invocation" object={{ kind: "invocation", id: inv.id }} label={inv.name}>
            {inv.name}
          </Presentation>
          <span style={{ opacity: 0.6, fontSize: 11 }}>
            {" "}
            {Object.values(inv.argValues).map((v) => v.label).join(", ")}
            {inv.status === "undone" ? " (undone)" : ""}
            {inv.error ? ` — ${inv.error}` : ""}
          </span>
        </div>
      ))}
    </Pane>
  );
}

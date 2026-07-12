/* The inverse-video mouse-doc bar and the Genera status line — pure
 * renderings of core's pull derivations (decision D8). */

import { useEffect, useState } from "react";
import { modeLabel, pointerDoc } from "@pbui/core";
import { useEngine, useEngineState } from "@pbui/react";

export function MouseDocBar(props: { right?: string }) {
  const engine = useEngine();
  useEngineState(); // re-render on engine changes
  return (
    <div className="pbui-docbar" role="status" aria-live="polite">
      <span className="pbui-docbar-text">{pointerDoc(engine)}</span>
      {props.right && <span className="pbui-docbar-right">{props.right}</span>}
    </div>
  );
}

function clockString(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function StatusLine(props: { user?: string; pkg?: string; host?: string }) {
  const engine = useEngine();
  useEngineState();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="pbui-status">
      <span>[{clockString(now)}]</span>
      <span>{props.user ?? "user"}</span>
      <span>{props.pkg ?? "PBUI"}:</span>
      <span className="pbui-status-mode">{modeLabel(engine)}</span>
      {props.host && <span className="pbui-status-host">{props.host}</span>}
    </div>
  );
}

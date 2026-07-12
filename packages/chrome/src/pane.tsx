/* Pane frame: bordered box with an inverse/centered title, optional
 * subtitle and extra header actions — the Panel/Pane primitive from the
 * corpus. */

import type { CSSProperties, ReactNode } from "react";

export function Pane(props: {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
  className?: string;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div className={`pbui-pane${props.className ? " " + props.className : ""}`} style={props.style}>
      <div className="pbui-pane-title">
        <span className="pbui-pane-title-text">{props.title}</span>
        {props.subtitle && <span className="pbui-pane-subtitle">{props.subtitle}</span>}
        {props.extra && <span className="pbui-pane-extra">{props.extra}</span>}
      </div>
      <div className="pbui-pane-body" style={props.bodyStyle}>
        {props.children}
      </div>
    </div>
  );
}

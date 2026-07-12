/* Sugar components over usePresentation: HTML (<Presentation>) and SVG
 * (<SvgPresentation>) renderings of the same gesture protocol. */

import type { CSSProperties, ReactNode } from "react";
import type { ObjectRef } from "@pbui/core";
import { usePresentation } from "./use-presentation.js";

export interface PresentationProps {
  type: string;
  ref?: never; // avoid confusion with React refs; use objectRef
  object: ObjectRef;
  label: string;
  pane?: string;
  quiet?: boolean;
  duringAccept?: "gated" | "active" | "fallthrough";
  disabled?: boolean;
  block?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
  children?: ReactNode;
}

export function Presentation(props: PresentationProps) {
  const h = usePresentation({
    type: props.type,
    ref: props.object,
    label: props.label,
    pane: props.pane,
    quiet: props.quiet,
    duringAccept: props.duringAccept,
    disabled: props.disabled,
  });
  const cls = `${h.className}${props.className ? " " + props.className : ""}`;
  const { ref: setEl, ...handlers } = h.props;
  if (props.block) {
    return (
      <div ref={setEl as any} {...handlers} className={cls} style={props.style} title={props.title}>
        {props.children}
      </div>
    );
  }
  return (
    <span ref={setEl as any} {...handlers} className={cls} style={props.style} title={props.title}>
      {props.children}
    </span>
  );
}

export interface SvgPresentationProps extends Omit<PresentationProps, "block"> {
  /** invisible hit rectangle behind the children (schema's SPres) */
  hitRect?: { x: number; y: number; width: number; height: number };
}

export function SvgPresentation(props: SvgPresentationProps) {
  const h = usePresentation({
    type: props.type,
    ref: props.object,
    label: props.label,
    pane: props.pane,
    quiet: props.quiet,
    duringAccept: props.duringAccept,
    disabled: props.disabled,
  });
  const cls = `${h.className}${props.className ? " " + props.className : ""}`;
  const { ref: setEl, ...handlers } = h.props;
  const r = props.hitRect;
  return (
    <g ref={setEl as any} {...handlers} className={cls} style={props.style}>
      {r && (
        <rect
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          fill="transparent"
          stroke="none"
        />
      )}
      {props.children}
      {r && h.isHovered && !props.quiet && (
        <rect
          className="pbui-svg-hover-ring"
          x={r.x - 2}
          y={r.y - 2}
          width={r.width + 4}
          height={r.height + 4}
          fill="none"
        />
      )}
      {r && h.isEligible && (
        <rect
          className="pbui-svg-eligible-ring"
          x={r.x - 3}
          y={r.y - 3}
          width={r.width + 6}
          height={r.height + 6}
          fill="none"
        />
      )}
    </g>
  );
}

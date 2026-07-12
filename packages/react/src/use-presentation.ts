/* The headless presentation hook (design decisions D3 of CLIM-JSX-001 and
 * §6.2 of CLIM-JSX-005).
 *
 * Registers a PresentationRecord in the engine's registry for the lifetime
 * of the component and returns gesture-protocol props plus derived state
 * flags. Subscription is TARGETED: the component listens to its own
 * presentation id only (registry.subscribePres), so a hover transition
 * re-renders exactly the presentations whose flags changed — not the whole
 * screen. Accept transitions broadcast via registry.notifyAllPres().
 */

import { useEffect, useReducer, useRef } from "react";
import type { ObjectRef, PresentationRecord } from "@pbui/core";
import { useEngine } from "./provider.js";

export interface UsePresentationInput {
  type: string;
  ref: ObjectRef;
  label: string;
  pane?: string;
  /** container presentations: still menuable, but don't flash hover
   * outlines over their contents, and never dim inert (metrics(3) quiet) */
  quiet?: boolean;
  /** participation during a foreign input context (CLIM-JSX-005 §5):
   * "gated" (default) dims + swallows; "active" stays interactive and may
   * run duringAccept commands; "fallthrough" goes gesture-transparent so
   * clicks reach the canvas beneath */
  duringAccept?: "gated" | "active" | "fallthrough";
  /** render-only: no registration, no gestures */
  disabled?: boolean;
}

export interface PresentationHandle {
  props: {
    ref: (el: Element | null) => void;
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseLeave: () => void;
    onClick: (e: React.MouseEvent) => void;
    onAuxClick: (e: React.MouseEvent) => void;
    onContextMenu: (e: React.MouseEvent) => void;
    "data-pbui-type": string;
  };
  isHovered: boolean;
  isEligible: boolean;
  isInert: boolean;
  /** some presentation of the same object is hovered elsewhere */
  isRelatedHover: boolean;
  className: string;
}

function refKey(r: ObjectRef): string {
  return "value" in r ? `v:${String(r.value)}` : `${r.kind}:${r.id}`;
}

declare global {
  interface Window {
    /** presentation render counter, read by the perf budget spec */
    __pbuiRenders?: number;
  }
}

export function usePresentation(input: UsePresentationInput): PresentationHandle {
  const engine = useEngine();
  if (typeof window !== "undefined")
    window.__pbuiRenders = (window.__pbuiRenders ?? 0) + 1;
  const elRef = useRef<Element | null>(null);
  const idRef = useRef<string | null>(null);
  const [, force] = useReducer((n: number) => n + 1, 0);

  const { type, ref, label, pane, quiet, disabled } = input;
  const mode = input.duringAccept ?? "gated";
  const key = refKey(ref);

  useEffect(() => {
    if (disabled) return;
    const id = engine.registry.register({
      type,
      ref,
      label,
      paneId: pane,
      mode,
      bounds: () => {
        const el = elRef.current;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      },
    });
    idRef.current = id;
    const unsub = engine.registry.subscribePres(id, force);
    force(); // flags may differ now that the record exists
    return () => {
      unsub();
      idRef.current = null;
      engine.registry.unregister(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, type, key, label, pane, mode, disabled]);

  const rec = (): PresentationRecord => ({
    id: idRef.current ?? `anon:${type}:${key}`,
    type,
    ref,
    label,
    paneId: pane,
    mode,
  });

  const st = engine.getState();
  const id = idRef.current;
  const hovered = !disabled && id != null && st.hover?.id === id;
  const eligible =
    !disabled && engine.eligible({ id: id ?? undefined, type, ref, label });
  const inContext = !disabled && !eligible && st.accept != null;
  // gated: dim + block; active: fully interactive; fallthrough: invisible
  // to gestures so events reach whatever is underneath (§5.4)
  const inert = inContext && !quiet && mode === "gated";
  const passthru = inContext && mode === "fallthrough";
  const relatedHover =
    !disabled && !hovered && st.hover != null && refKey(st.hover.ref) === key;

  const props: PresentationHandle["props"] = {
    ref: (el) => {
      elRef.current = el;
    },
    onMouseMove: (e) => {
      if (disabled) return;
      e.stopPropagation(); // innermost presentation wins
      const r = rec();
      if (engine.getState().hover?.id !== r.id)
        engine.gesture("enter", r, e.clientX, e.clientY);
      else engine.notePointer(e.clientX, e.clientY);
    },
    onMouseLeave: () => {
      if (disabled) return;
      engine.gesture("leave", rec());
    },
    onClick: (e) => {
      if (disabled) return;
      e.stopPropagation();
      engine.closeMenu();
      engine.gesture("click", rec(), e.clientX, e.clientY);
    },
    onAuxClick: (e) => {
      if (disabled || e.button !== 1) return;
      e.stopPropagation();
      engine.gesture("aux", rec(), e.clientX, e.clientY);
    },
    onContextMenu: (e) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      engine.gesture("context", rec(), e.clientX, e.clientY);
    },
    "data-pbui-type": type,
  };

  const className = [
    "pbui-pres",
    hovered && !quiet ? "pbui-hover" : "",
    eligible ? "pbui-eligible" : "",
    inert ? "pbui-inert" : "",
    passthru ? "pbui-passthru" : "",
    relatedHover && !quiet ? "pbui-related" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    props,
    isHovered: hovered,
    isEligible: eligible,
    isInert: inert,
    isRelatedHover: relatedHover,
    className,
  };
}

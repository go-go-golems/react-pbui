/* The headless presentation hook (design decision D3).
 *
 * Registers a PresentationRecord in the engine's registry for the lifetime
 * of the component and returns gesture-protocol props plus derived state
 * flags. <Presentation> and <SvgPresentation> are thin sugar over this.
 */

import { useEffect, useMemo, useRef } from "react";
import type { ObjectRef, PresentationRecord } from "@pbui/core";
import { useEngine, useEngineState } from "./provider.js";

export interface UsePresentationInput {
  type: string;
  ref: ObjectRef;
  label: string;
  pane?: string;
  /** container presentations: still menuable, but don't flash hover
   * outlines over their contents (metrics(3)'s quiet flag) */
  quiet?: boolean;
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

export function usePresentation(input: UsePresentationInput): PresentationHandle {
  const engine = useEngine();
  const state = useEngineState();
  const elRef = useRef<Element | null>(null);
  const idRef = useRef<string | null>(null);

  const { type, ref, label, pane, quiet, disabled } = input;
  const key = refKey(ref);

  useEffect(() => {
    if (disabled) return;
    const id = engine.registry.register({
      type,
      ref,
      label,
      paneId: pane,
      bounds: () => {
        const el = elRef.current;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      },
    });
    idRef.current = id;
    return () => {
      idRef.current = null;
      engine.registry.unregister(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, type, key, label, pane, disabled]);

  return useMemo(() => {
    const rec = (): PresentationRecord => ({
      id: idRef.current ?? `anon:${type}:${key}`,
      type,
      ref,
      label,
      paneId: pane,
    });
    const hovered = !disabled && state.hover?.id === (idRef.current ?? "");
    const eligible = !disabled && engine.eligible({ type, ref, label });
    const inert = !disabled && !quiet && engine.inert({ type, ref, label });
    const relatedHover =
      !disabled &&
      !hovered &&
      state.hover != null &&
      refKey(state.hover.ref) === key;

    const props: PresentationHandle["props"] = {
      ref: (el) => {
        elRef.current = el;
      },
      onMouseMove: (e) => {
        if (disabled) return;
        e.stopPropagation(); // innermost presentation wins
        const r = rec();
        if (state.hover?.id !== r.id) engine.gesture("enter", r, e.clientX, e.clientY);
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
  }, [engine, state, type, key, label, pane, quiet, disabled]);
}

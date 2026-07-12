/* PbuiProvider: puts a PbuiEngine in context and wires global keyboard
 * handling (Escape aborts / dismisses, per the corpus-wide convention). */

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { EngineState, PbuiEngine } from "@pbui/core";

const EngineCtx = createContext<PbuiEngine<any> | null>(null);

export function PbuiProvider(props: {
  engine: PbuiEngine<any>;
  children: ReactNode;
}) {
  const { engine, children } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") engine.escape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);
  return <EngineCtx.Provider value={engine}>{children}</EngineCtx.Provider>;
}

export function useEngine<W = unknown>(): PbuiEngine<W> {
  const engine = useContext(EngineCtx);
  if (!engine) throw new Error("useEngine: no <PbuiProvider> above");
  return engine as PbuiEngine<W>;
}

/** subscribe to engine interaction state (hover / accept / menu) */
export function useEngineState(): EngineState {
  const engine = useEngine();
  return useSyncExternalStore(
    (fn) => engine.subscribe(fn),
    () => engine.getState(),
    () => engine.getState(),
  );
}

/** subscribe to the transcript */
export function useTranscript() {
  const engine = useEngine();
  return useSyncExternalStore(
    (fn) => engine.transcript.subscribe(fn),
    () => engine.transcript.lines(),
    () => engine.transcript.lines(),
  );
}

/** Root-surface handlers: clear hover on background moves, background menu
 * on right-click, dismiss menus on click. Spread onto the app's outermost
 * element. */
export function usePbuiSurface() {
  const engine = useEngine();
  return {
    onMouseMove: () => {
      if (engine.getState().hover) engine.gesture("leave", engine.getState().hover!);
    },
    onClick: () => engine.closeMenu(),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      engine.backgroundContext(e.clientX, e.clientY);
    },
  };
}

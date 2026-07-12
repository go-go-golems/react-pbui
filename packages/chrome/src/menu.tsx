/* ContextMenuHost: renders the engine's menu state — the viewport-clamped,
 * type-titled popup every prototype rebuilt. Serves command menus and
 * choice menus for menu-valued arguments.
 *
 * Keyboard/a11y (CLIM-JSX-004 §6.3): a real ARIA menu — focus moves in on
 * open and returns to the invoking element on close; ArrowUp/Down wrap,
 * Home/End jump, Enter/Space activate, printable keys type-ahead. */

import { useEffect, useRef, useState } from "react";
import { useEngine, useEngineState } from "@pbui/react";

export function ContextMenuHost() {
  const engine = useEngine();
  const { menu } = useEngineState();
  const ref = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const typeahead = useRef<{ buf: string; at: number }>({ buf: "", at: 0 });
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);

  const items = menu?.items ?? [];
  // the Abort footer participates in keyboard navigation as the last item
  const itemCount = items.length + 1;

  useEffect(() => {
    if (!menu) {
      setPos(null);
      // return focus to whatever invoked the menu
      restoreRef.current?.focus?.();
      restoreRef.current = null;
      return;
    }
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    setFocusIdx(0);
    typeahead.current = { buf: "", at: 0 };
    // clamp to viewport after measuring, then take focus
    const el = ref.current;
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 200;
    const x = Math.min(menu.x, window.innerWidth - w - 8);
    const y = Math.min(menu.y, window.innerHeight - h - 8);
    setPos({ x: Math.max(4, x), y: Math.max(4, y) });
    el?.focus();
  }, [menu]);

  if (!menu) return null;

  const activate = (i: number) => {
    if (i < items.length) {
      const item = items[i]!;
      if (item.disabled) return;
      engine.closeMenu();
      item.run();
    } else {
      // Abort footer
      engine.closeMenu();
      if (engine.getState().accept) engine.abort();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => (i + 1) % itemCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusIdx((i) => (i - 1 + itemCount) % itemCount);
    } else if (e.key === "Home") {
      e.preventDefault();
      setFocusIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setFocusIdx(itemCount - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate(focusIdx);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // type-ahead: accumulate a prefix (resets after 800ms of quiet)
      const now = performance.now();
      const ta = typeahead.current;
      ta.buf = now - ta.at > 800 ? e.key : ta.buf + e.key;
      ta.at = now;
      const needle = ta.buf.toLowerCase();
      const start = ta.buf.length === 1 ? focusIdx + 1 : focusIdx;
      for (let k = 0; k < items.length; k++) {
        const i = (start + k) % items.length;
        if (items[i]!.label.toLowerCase().startsWith(needle)) {
          setFocusIdx(i);
          break;
        }
      }
    }
  };

  return (
    <div
      ref={ref}
      className="pbui-menu"
      role="menu"
      aria-label={menu.title}
      tabIndex={-1}
      style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, outline: "none" }}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="pbui-menu-title">{menu.title}</div>
      {items.length === 0 && (
        <div className="pbui-menu-item pbui-menu-disabled" role="menuitem" aria-disabled="true">
          (no applicable commands)
        </div>
      )}
      {items.map((item, i) => (
        <div
          key={i}
          className={`pbui-menu-item${item.disabled ? " pbui-menu-disabled" : ""}${i === focusIdx ? " pbui-menu-focus" : ""}`}
          role="menuitem"
          aria-disabled={item.disabled || undefined}
          title={item.doc}
          onMouseEnter={() => setFocusIdx(i)}
          onClick={() => activate(i)}
        >
          {item.label}
        </div>
      ))}
      <div className="pbui-menu-sep" />
      <div
        className={`pbui-menu-item pbui-menu-abort${focusIdx === items.length ? " pbui-menu-focus" : ""}`}
        role="menuitem"
        onMouseEnter={() => setFocusIdx(items.length)}
        onClick={() => activate(items.length)}
      >
        Abort
      </div>
    </div>
  );
}

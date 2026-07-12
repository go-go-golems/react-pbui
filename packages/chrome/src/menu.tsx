/* ContextMenuHost: renders the engine's menu state — the hard-shadow,
 * viewport-clamped, type-titled popup every prototype rebuilt. Also serves
 * choice menus for menu-valued arguments. */

import { useEffect, useRef, useState } from "react";
import { useEngine, useEngineState } from "@pbui/react";

export function ContextMenuHost() {
  const engine = useEngine();
  const { menu } = useEngineState();
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) {
      setPos(null);
      return;
    }
    // clamp to viewport after measuring
    const el = ref.current;
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 200;
    const x = Math.min(menu.x, window.innerWidth - w - 8);
    const y = Math.min(menu.y, window.innerHeight - h - 8);
    setPos({ x: Math.max(4, x), y: Math.max(4, y) });
  }, [menu]);

  if (!menu) return null;
  return (
    <div
      ref={ref}
      className="pbui-menu"
      style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="pbui-menu-title">{menu.title}</div>
      {menu.items.length === 0 && (
        <div className="pbui-menu-item pbui-menu-disabled">(no applicable commands)</div>
      )}
      {menu.items.map((item, i) => (
        <div
          key={i}
          className={`pbui-menu-item${item.disabled ? " pbui-menu-disabled" : ""}`}
          title={item.doc}
          onClick={() => {
            if (item.disabled) return;
            engine.closeMenu();
            item.run();
          }}
        >
          {item.label}
        </div>
      ))}
      <div className="pbui-menu-sep" />
      <div
        className="pbui-menu-item pbui-menu-abort"
        onClick={() => {
          engine.closeMenu();
          if (engine.getState().accept) engine.abort();
        }}
      >
        Abort
      </div>
    </div>
  );
}

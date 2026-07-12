/* #bench — the render-budget harness (CLIM-JSX-005 §6.4). Not listed in
 * the launcher. Renders N item presentations in a grid; the perf spec
 * drives synthetic hovers and reads window.__pbuiRenders.
 *
 * URL: /#bench (N defaults to 2000; override with localStorage.benchN)
 */

import { useEffect, useMemo, useRef } from "react";
import {
  B,
  CommandTable,
  PbuiEngine,
  PTypes,
  defineBuiltinPtypes,
  type Resolver,
} from "@pbui/core";
import { PbuiProvider, Presentation, usePbuiSurface } from "@pbui/react";
import { ContextMenuHost, MouseDocBar, Pane, StatusLine } from "@pbui/chrome";
import { Listener } from "@pbui/listener";

interface Item {
  id: string;
  name: string;
  group: number;
}

function makeEngine(n: number) {
  const items = new Map<string, Item>();
  for (let i = 0; i < n; i++)
    items.set(`i${i}`, { id: `i${i}`, name: `ITEM-${i}`, group: i % 7 });
  const world = { items };
  const ptypes = new PTypes<typeof world>();
  defineBuiltinPtypes(ptypes);
  ptypes.define<Item>({
    name: "item",
    print: (it) => `#<ITEM ${it.name} g${it.group}>`,
    parse: (text, w) => {
      const t = text.trim().toUpperCase();
      for (const it of w.items.values())
        if (it.name === t || it.name.startsWith(t))
          return { ok: true, value: it, ref: { kind: "item", id: it.id }, label: it.name };
      return { ok: false, err: `${text} does not name an ITEM` };
    },
  });
  const commands = new CommandTable<typeof world>();
  commands.define({
    name: "Pair Items",
    args: [
      { name: "item-a", type: "item" },
      { name: "item-b", type: "item", distinct: true },
    ],
    run: (args, api) => {
      api.print(`paired ${args["item-a"]!.label} with ${args["item-b"]!.label}`);
    },
  });
  const resolver: Resolver = {
    resolve: (ref) => ("id" in ref ? world.items.get(ref.id) : undefined),
  };
  return new PbuiEngine({ ptypes, commands, world, resolver, idleDoc: "bench" });
}

function BenchApp({ engine, n }: { engine: PbuiEngine<any>; n: number }) {
  const surface = usePbuiSurface();
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    engine.print(B(`bench ready`), ` — ${n} presentations`);
    // signal readiness + expose a reset for the spec
    (window as any).__benchReady = true;
  }, [engine, n]);
  const items = [...(engine.world as { items: Map<string, Item> }).items.values()];
  return (
    <div className="pbui-root" style={{ height: "100vh", display: "flex", flexDirection: "column" }} {...surface}>
      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 8, padding: 8 }}>
        <Pane title="Bench Grid" subtitle={`${n} items`} style={{ flex: 3 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
            {items.map((it) => (
              <Presentation
                key={it.id}
                type="item"
                object={{ kind: "item", id: it.id }}
                label={it.name}
                block
                className="bench-cell"
                style={{ width: 14, height: 14, border: "1px solid var(--pbui-ink)", fontSize: 6, overflow: "hidden" }}
              />
            ))}
          </div>
        </Pane>
        <Pane title="Listener" style={{ flex: 1 }} bodyStyle={{ padding: 0, display: "flex" }}>
          <Listener style={{ flex: 1 }} prompt="BENCH> " />
        </Pane>
      </div>
      <ContextMenuHost />
      <MouseDocBar />
      <StatusLine user="bench" pkg="BENCH" />
    </div>
  );
}

export default function BenchDemo() {
  const n = Number(localStorage.getItem("benchN") ?? 2000);
  const engine = useMemo(() => makeEngine(n), [n]);
  return (
    <PbuiProvider engine={engine}>
      <BenchApp engine={engine} n={n} />
    </PbuiProvider>
  );
}

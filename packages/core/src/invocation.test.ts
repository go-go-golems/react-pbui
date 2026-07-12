import { describe, expect, it } from "vitest";
import {
  arg,
  commandBuilder,
  installUndoCommands,
  CommandTable,
  PbuiEngine,
  PTypes,
  defineBuiltinPtypes,
  renderTranscript,
  type Resolver,
} from "./index.js";

/* a tiny immutable store, mirroring apps/demos/src/lib/store.ts */
class MiniStore<T> {
  constructor(private state: T) {}
  get(): T {
    return this.state;
  }
  set(next: T): void {
    this.state = next;
  }
  update(fn: (s: T) => T): void {
    this.state = fn(this.state);
  }
}

interface World {
  store: MiniStore<{ counter: number; label: string }>;
}

function makeEngine() {
  const world: World = { store: new MiniStore({ counter: 0, label: "start" }) };
  const ptypes = new PTypes<World>();
  defineBuiltinPtypes(ptypes);
  const commands = new CommandTable<World>();
  const c = commandBuilder(commands);
  c.define({
    name: "Increment",
    global: true,
    args: { by: arg.number({ default: 1 }) },
    run: ({ by }, api) => {
      api.snapshotUndo(api.world.store);
      api.world.store.update((s) => ({ ...s, counter: s.counter + by }));
      api.print(`counter is now ${api.world.store.get().counter}`);
    },
  });
  c.define({
    name: "Relabel",
    global: true,
    args: { label: arg.text() },
    run: ({ label }, api) => {
      const prev = api.world.store.get().label;
      api.undoable(() => () => api.world.store.update((s) => ({ ...s, label: prev })));
      api.world.store.update((s) => ({ ...s, label }));
    },
  });
  c.define({
    name: "Explode",
    global: true,
    args: {},
    run: () => {
      throw new Error("boom");
    },
  });
  c.define({
    name: "Look",
    global: true,
    args: {},
    run: (_a, api) => api.print("looking"),
  });
  const resolver: Resolver = { resolve: () => undefined };
  const engine = new PbuiEngine<World>({ ptypes, commands, world, resolver });
  installUndoCommands(engine);
  return { engine, world };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("invocation records", () => {
  it("records lifecycle: executing -> completed, with echo-line linkage", async () => {
    const { engine } = makeEngine();
    engine.submitCommandLine("increment 5");
    await tick();
    const inv = engine.invocations.list().at(-1)!;
    expect(inv.name).toBe("Increment");
    expect(inv.status).toBe("completed");
    expect(inv.undo).toBeDefined();
    expect(inv.echoLineId).toBeDefined();
    expect(engine.invocations.byEchoLine(inv.echoLineId!)?.id).toBe(inv.id);
  });

  it("records failures from thrown errors", async () => {
    const { engine } = makeEngine();
    engine.submitCommandLine("explode");
    await tick();
    const inv = engine.invocations.list().at(-1)!;
    expect(inv.status).toBe("failed");
    expect(inv.error).toBe("boom");
  });

  it("commands without opt-in are recorded but not undoable", async () => {
    const { engine } = makeEngine();
    engine.submitCommandLine("look");
    await tick();
    const inv = engine.invocations.list().at(-1)!;
    expect(inv.status).toBe("completed");
    expect(inv.undo).toBeUndefined();
    expect(engine.invocations.lastUndoable()).toBeUndefined();
  });
});

describe("undo", () => {
  it("snapshot undo restores the exact pre-run state", async () => {
    const { engine, world } = makeEngine();
    const before = world.store.get();
    engine.submitCommandLine("increment 5");
    await tick();
    expect(world.store.get().counter).toBe(5);
    engine.submitCommandLine("undo");
    await tick();
    expect(world.store.get()).toBe(before); // same object — structural restore
    expect(engine.invocations.list().at(-2)?.status).toBe("undone");
    expect(renderTranscript(engine.transcript.lines())).toContain("**Undid:** Increment");
  });

  it("explicit-inverse undo runs the captured closure", async () => {
    const { engine, world } = makeEngine();
    engine.submitCommandLine("relabel renamed");
    await tick();
    expect(world.store.get().label).toBe("renamed");
    await engine.undoInvocation();
    expect(world.store.get().label).toBe("start");
  });

  it("is linear: refuses undoing anything but the last undoable", async () => {
    const { engine, world } = makeEngine();
    engine.submitCommandLine("increment 1");
    await tick();
    const first = engine.invocations.lastUndoable()!;
    engine.submitCommandLine("increment 10");
    await tick();
    const ok = await engine.undoInvocation(first.id);
    expect(ok).toBe(false);
    expect(world.store.get().counter).toBe(11);
    expect(renderTranscript(engine.transcript.lines())).toContain("Undo is linear");
    // undoing the last one works, then the first becomes undoable
    await engine.undoInvocation();
    expect(world.store.get().counter).toBe(1);
    await engine.undoInvocation();
    expect(world.store.get().counter).toBe(0);
  });

  it("says so when there is nothing to undo", async () => {
    const { engine } = makeEngine();
    const ok = await engine.undoInvocation();
    expect(ok).toBe(false);
    expect(renderTranscript(engine.transcript.lines())).toContain("Nothing to undo.");
  });
});

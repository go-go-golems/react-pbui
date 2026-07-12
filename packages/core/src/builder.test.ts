import { describe, expect, it } from "vitest";
import {
  arg,
  commandBuilder,
  CommandTable,
  PbuiEngine,
  PTypes,
  defineBuiltinPtypes,
  renderTranscript,
  type PresentationRecord,
  type Resolver,
} from "./index.js";

/* fixture world */

interface Ship {
  id: string;
  name: string;
  fuel: number;
}

interface World {
  ships: Map<string, Ship>;
  log: string[];
}

function makeWorld(): World {
  const ships = new Map<string, Ship>();
  for (const [id, name, fuel] of [
    ["a", "AURORA", 80],
    ["b", "BOREALIS", 30],
  ] as const)
    ships.set(id, { id, name, fuel });
  return { ships, log: [] };
}

function makePtypes() {
  const ptypes = new PTypes<World>();
  defineBuiltinPtypes(ptypes);
  ptypes.define<Ship>({
    name: "ship",
    print: (s) => `#<SHIP ${s.name}>`,
    parse: (text, w) => {
      const t = text.trim().toUpperCase();
      for (const s of w.ships.values())
        if (s.name.startsWith(t))
          return { ok: true, value: s, ref: { kind: "ship", id: s.id }, label: s.name };
      return { ok: false, err: `${text} does not name a SHIP` };
    },
  });
  return ptypes;
}

function makeResolver(world: World): Resolver {
  return { resolve: (ref) => ("id" in ref ? world.ships.get(ref.id) : undefined) };
}

const shipPres = (id: string, name: string): PresentationRecord => ({
  id: `p-${id}`,
  type: "ship",
  ref: { kind: "ship", id },
  label: name,
});

/* v1 vs builder equivalence: identical behavior, identical transcripts */

function makeV1Engine(world: World) {
  const commands = new CommandTable<World>();
  commands.define({
    name: "Refuel Ship",
    args: [{ name: "ship", type: "ship" }],
    run: (args, api) => {
      const s = api.resolve(args["ship"]!) as Ship | undefined;
      if (!s) return api.fail(`${args["ship"]!.label} no longer exists — presentation was stale;`);
      api.world.log.push(`refuel ${s.name}`);
      api.print("Refuelled ", { t: "pres", type: "ship", ref: args["ship"]!.ref, label: s.name }, ".");
    },
  });
  return new PbuiEngine<World>({ ptypes: makePtypes(), commands, world, resolver: makeResolver(world) });
}

function makeBuilderEngine(world: World) {
  const commands = new CommandTable<World>();
  const c = commandBuilder(commands);
  c.define({
    name: "Refuel Ship",
    args: { ship: arg.presentation<Ship>("ship") },
    run: ({ ship }, api) => {
      api.world.log.push(`refuel ${ship.name}`);
      api.print("Refuelled ", { t: "pres", type: "ship", ref: { kind: "ship", id: ship.id }, label: ship.name }, ".");
    },
  });
  return new PbuiEngine<World>({ ptypes: makePtypes(), commands, world, resolver: makeResolver(world) });
}

describe("builder equivalence with v1", () => {
  it("produces identical transcripts and effects", async () => {
    const w1 = makeWorld();
    const w2 = makeWorld();
    const e1 = makeV1Engine(w1);
    const e2 = makeBuilderEngine(w2);
    for (const e of [e1, e2]) {
      e.startCommand("Refuel Ship", shipPres("a", "AURORA"));
      await Promise.resolve(); // builder run is async
    }
    expect(w2.log).toEqual(w1.log);
    expect(renderTranscript(e2.transcript.lines())).toBe(renderTranscript(e1.transcript.lines()));
  });

  it("aborts centrally on stale entities with the standardized message", async () => {
    const world = makeWorld();
    const e = makeBuilderEngine(world);
    e.startCommand("Refuel Ship", shipPres("ghost", "PHANTOM"));
    await Promise.resolve();
    expect(world.log).toEqual([]);
    const text = renderTranscript(e.transcript.lines());
    expect(text).toContain("PHANTOM no longer exists — presentation was stale; Refuel Ship aborted.");
  });
});

describe("builder features", () => {
  function makeFeatureEngine(world: World) {
    const commands = new CommandTable<World>();
    const c = commandBuilder(commands);
    c.define({
      name: "Transfer Fuel",
      args: {
        from: arg.presentation<Ship>("ship"),
        to: arg.presentation<Ship>("ship", {
          distinct: true,
          where: (to, soFar) => to.id !== (soFar as { from?: Ship }).from?.id,
        }),
        amount: arg.number({ min: 1, max: 100, integer: true, default: 10 }),
      },
      run: ({ from, to, amount }, api) => {
        api.world.log.push(`${from.name}->${to.name}:${amount}`);
      },
    });
    c.define({
      name: "Paint Ship",
      args: {
        ship: arg.presentation<Ship>("ship"),
        color: arg.choice({ options: () => [
          { label: "black", value: "black" },
          { label: "ecru", value: "ecru" },
        ] }),
      },
      appliesTo: (ship) => (ship as Ship).fuel > 50, // only fueled ships get painted
      run: ({ ship, color }, api) => {
        api.world.log.push(`paint ${ship.name} ${color}`);
      },
    });
    return new PbuiEngine<World>({ ptypes: makePtypes(), commands, world, resolver: makeResolver(world) });
  }

  it("number sugar validates range/integer; empty Enter takes the default", async () => {
    const world = makeWorld();
    const e = makeFeatureEngine(world);
    e.startCommand("Transfer Fuel", shipPres("a", "AURORA"));
    e.gesture("click", shipPres("b", "BOREALIS"));
    e.submitTyped("999");
    expect(renderTranscript(e.transcript.lines())).toContain("amount must be at most 100");
    e.submitTyped("2.5");
    expect(renderTranscript(e.transcript.lines())).toContain("amount must be an integer");
    e.submitTyped("");
    await Promise.resolve();
    expect(world.log).toEqual(["AURORA->BOREALIS:10"]);
  });

  it("where receives resolved candidate and soFar", () => {
    const world = makeWorld();
    const e = makeFeatureEngine(world);
    e.startCommand("Transfer Fuel", shipPres("a", "AURORA"));
    expect(e.eligible(shipPres("a", "AURORA"))).toBe(false); // where + distinct
    expect(e.eligible(shipPres("b", "BOREALIS"))).toBe(true);
  });

  it("appliesTo receives the resolved first argument", () => {
    const world = makeWorld();
    const e = makeFeatureEngine(world);
    const aurora = shipPres("a", "AURORA"); // fuel 80
    const borealis = shipPres("b", "BOREALIS"); // fuel 30
    const names = (p: PresentationRecord) => e.applicableCommands(p).map((c) => c.name);
    expect(names(aurora)).toContain("Paint Ship");
    expect(names(borealis)).not.toContain("Paint Ship");
  });

  it("choice args open a menu and deliver the typed value", async () => {
    const world = makeWorld();
    const e = makeFeatureEngine(world);
    e.startCommand("Paint Ship", shipPres("a", "AURORA"));
    const menu = e.getState().menu;
    expect(menu?.items.map((i) => i.label)).toEqual(["black", "ecru"]);
    menu!.items[1]!.run();
    await Promise.resolve();
    expect(world.log).toEqual(["paint AURORA ecru"]);
  });
});

describe("builder type safety", () => {
  it("compiles the negative cases away", () => {
    const commands = new CommandTable<World>();
    const c = commandBuilder(commands);
    c.define({
      name: "Typed",
      args: { ship: arg.presentation<Ship>("ship"), n: arg.number() },
      run: ({ ship, n }, _api) => {
        const _name: string = ship.name; // resolved Ship
        const _n2: number = n; // resolved number
        // @ts-expect-error unknown arg key
        void ({ ship, n } as ResolvedShim).nope;
        // @ts-expect-error ship is not a number
        const _bad: number = ship;
        void _name; void _n2; void _bad;
      },
    });
    expect(commands.get("Typed")).toBeDefined();
  });
});

type ResolvedShim = { ship: Ship; n: number };

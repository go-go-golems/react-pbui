import { describe, expect, it } from "vitest";
import {
  CommandTable,
  PbuiEngine,
  PTypes,
  defineBuiltinPtypes,
  pointerDoc,
  modeLabel,
  valueRef,
  type ArgValues,
  type PresentationRecord,
  type Resolver,
} from "./index.js";

/* ------------------------------ test fixture ------------------------------ */

interface Site {
  id: string;
  name: string;
  load: number;
}

interface World {
  sites: Map<string, Site>;
  log: string[];
}

function makeWorld(): World {
  const sites = new Map<string, Site>();
  for (const [id, name] of [
    ["s1", "SITE-ALPHA"],
    ["s2", "SITE-BETA"],
    ["s3", "SITE-GAMMA"],
  ] as const)
    sites.set(id, { id, name, load: 10 });
  return { sites, log: [] };
}

function makeEngine(world = makeWorld()) {
  const ptypes = new PTypes<World>();
  defineBuiltinPtypes(ptypes);
  ptypes.define<Site>({
    name: "site",
    print: (s) => `#<SITE ${s?.name ?? "?"}>`,
    parse: (text, w) => {
      const t = text.trim().toUpperCase();
      for (const s of w.sites.values()) {
        if (s.name === t || s.name.startsWith(t))
          return { ok: true, value: s, ref: { kind: "site", id: s.id }, label: s.name };
      }
      return { ok: false, err: `${text} does not name a SITE` };
    },
  });
  ptypes.define({ name: "milestone", supertypes: ["site"] }); // toy lattice
  ptypes.define({ name: "panel" });
  ptypes.define({ name: "events" });

  const commands = new CommandTable<World>();
  commands.define({
    name: "Compare Sites",
    doc: "Compare two sites.",
    args: [
      { name: "site-a", type: "site" },
      { name: "site-b", type: "site", distinct: true },
    ],
    run: (args, api) => {
      api.world.log.push(`compare ${args["site-a"]!.label} ${args["site-b"]!.label}`);
      api.print("Compared ", args["site-a"]!.label, " with ", args["site-b"]!.label);
    },
  });
  commands.define({
    name: "Set Update Interval",
    global: true,
    args: [{ name: "interval", type: "number", input: "typed",
             default: () => ({ type: "number", ref: valueRef(650), label: "650" }) }],
    run: (args, api) => {
      api.world.log.push(`interval ${args["interval"]!.label}`);
    },
  });
  commands.define({
    name: "Watch Task",
    args: [{ name: "window", type: "events" }],
    run: (args, api) => {
      api.world.log.push(`watch via ${args["window"]!.type}`);
    },
  });
  commands.define({
    name: "Reset Site",
    args: [{ name: "site", type: "site" }],
    isDefaultFor: ["site"],
    run: (args, api) => {
      api.world.log.push(`reset ${args["site"]!.label}`);
    },
  });

  const resolver: Resolver = {
    resolve: (ref) => ("id" in ref ? world.sites.get(ref.id) : undefined),
  };
  const engine = new PbuiEngine<World>({ ptypes, commands, world, resolver });
  return { engine, world, ptypes, commands };
}

function sitePres(id: string, name: string): PresentationRecord {
  return { id: `t-${id}`, type: "site", ref: { kind: "site", id }, label: name };
}

function transcriptText(engine: PbuiEngine<World>): string[] {
  return engine.transcript
    .lines()
    .map((l) => l.parts.map((p) => ("s" in p ? p.s : p.label)).join(""));
}

/* --------------------------------- ptypes --------------------------------- */

describe("ptype lattice", () => {
  it("walks supertype chains and treats any as top", () => {
    const { ptypes } = makeEngine();
    expect(ptypes.subtypep("milestone", "site")).toBe(true);
    expect(ptypes.subtypep("site", "milestone")).toBe(false);
    expect(ptypes.subtypep("site", "any")).toBe(true);
    expect(ptypes.latticeLabel("milestone")).toBe("MILESTONE ⊂ SITE ⊂ ANY");
  });

  it("rejects unknown supertypes", () => {
    const p = new PTypes();
    expect(() => p.define({ name: "x", supertypes: ["nope"] })).toThrow();
  });

  it("round-trips numbers through the builtin codec", () => {
    const p = new PTypes();
    defineBuiltinPtypes(p);
    const num = p.get("number")!;
    const r = num.parse!("42", undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(num.print!(r.value)).toBe("42");
    expect(num.parse!("abc", undefined)).toEqual({
      ok: false,
      err: "abc is not a valid NUMBER",
    });
  });
});

/* -------------------------------- registry -------------------------------- */

describe("presentation registry", () => {
  it("indexes by ref, type and point; smallest wins at()", () => {
    const { engine } = makeEngine();
    const big = engine.registry.register({
      type: "site",
      ref: { kind: "site", id: "s1" },
      label: "SITE-ALPHA",
      bounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
    });
    engine.registry.register({
      type: "site",
      ref: { kind: "site", id: "s1" },
      label: "SITE-ALPHA",
      bounds: () => ({ x: 10, y: 10, w: 20, h: 20 }),
    });
    expect(engine.registry.byRef({ kind: "site", id: "s1" })).toHaveLength(2);
    expect(engine.registry.byType("site")).toHaveLength(2);
    const hit = engine.registry.at(15, 15);
    expect(hit).toBeDefined();
    expect(hit!.id).not.toBe(big);
    engine.registry.unregister(big);
    expect(engine.registry.byRef({ kind: "site", id: "s1" })).toHaveLength(1);
  });
});

/* ------------------------------ accept loop ------------------------------- */

describe("accept loop", () => {
  it("seeds arg 0 from the invoking presentation and prompts for the rest", () => {
    const { engine } = makeEngine();
    engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    const acc = engine.getState().accept!;
    expect(acc.spec.name).toBe("site-b");
    expect(acc.values["site-a"]!.label).toBe("SITE-ALPHA");
  });

  it("partitions presentations into eligible and inert", () => {
    const { engine } = makeEngine();
    engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    expect(engine.eligible(sitePres("s2", "SITE-BETA"))).toBe(true);
    // distinct: the already-supplied site is not eligible again
    expect(engine.eligible(sitePres("s1", "SITE-ALPHA"))).toBe(false);
    expect(engine.inert({ type: "panel", ref: { kind: "panel", id: "x" }, label: "P" })).toBe(true);
  });

  it("executes when the last argument is supplied by pointing", () => {
    const { engine, world } = makeEngine();
    engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    engine.gesture("click", sitePres("s2", "SITE-BETA"));
    expect(world.log).toEqual(["compare SITE-ALPHA SITE-BETA"]);
    expect(engine.getState().accept).toBeNull();
    const text = transcriptText(engine);
    expect(text[0]).toBe("Command: Compare Sites (site-a) SITE-ALPHA");
    expect(text[1]).toContain("site-b (a SITE) ⇒ SITE-BETA");
  });

  it("rejects a duplicate for a distinct argument with an error line", () => {
    const { engine, world } = makeEngine();
    engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    engine.supply(sitePres("s1", "SITE-ALPHA"));
    // supply() on ineligible pres swallows; force through supplyValue to test the guard
    engine.supplyValue({ type: "site", ref: { kind: "site", id: "s1" }, label: "SITE-ALPHA" });
    expect(world.log).toEqual([]);
    expect(transcriptText(engine).some((l) => l.includes("already supplied"))).toBe(true);
  });

  it("accepts typed input via the ptype parser, including prefixes", () => {
    const { engine, world } = makeEngine();
    engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    expect(engine.submitTyped("site-b")).toBe(true); // prefix of SITE-BETA
    expect(world.log).toEqual(["compare SITE-ALPHA SITE-BETA"]);
  });

  it("takes the default on empty Enter", () => {
    const { engine, world } = makeEngine();
    engine.startCommand("Set Update Interval");
    expect(engine.getState().accept!.spec.name).toBe("interval");
    engine.submitTyped("");
    expect(world.log).toEqual(["interval 650"]);
  });

  it("reports parse failures without consuming the argument", () => {
    const { engine } = makeEngine();
    engine.startCommand("Set Update Interval");
    engine.submitTyped("abc");
    expect(engine.getState().accept).not.toBeNull();
    expect(transcriptText(engine).some((l) => l.includes("not a valid NUMBER"))).toBe(true);
  });

  it("aborts on escape with an [Abort] echo, at every stage", () => {
    const { engine, world } = makeEngine();
    engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    engine.escape();
    expect(engine.getState().accept).toBeNull();
    expect(world.log).toEqual([]);
    expect(transcriptText(engine).at(-1)).toBe("[Abort]");
  });

  it("right-click during an accept aborts instead of opening a menu", () => {
    const { engine } = makeEngine();
    engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    engine.gesture("context", sitePres("s2", "SITE-BETA"), 5, 5);
    expect(engine.getState().accept).toBeNull();
    expect(engine.getState().menu).toBeNull();
  });
});

/* ---------------------------- gestures & menus ----------------------------- */

describe("gestures and menus", () => {
  it("left-click outside a context runs the default command for the type", () => {
    const { engine, world } = makeEngine();
    engine.gesture("click", sitePres("s2", "SITE-BETA"));
    expect(world.log).toEqual(["reset SITE-BETA"]);
  });

  it("middle-click describes via the ptype printer", () => {
    const { engine } = makeEngine();
    engine.gesture("aux", sitePres("s1", "SITE-ALPHA"));
    expect(transcriptText(engine).at(-1)).toBe("#<SITE SITE-ALPHA>");
  });

  it("describe flags stale presentations", () => {
    const { engine } = makeEngine();
    engine.describePres({ type: "site", ref: { kind: "site", id: "gone" }, label: "SITE-OLD" });
    expect(transcriptText(engine).at(-1)).toContain("presentation was stale");
  });

  it("builds the object menu from applicable commands with … for partials", () => {
    const { engine } = makeEngine();
    engine.gesture("context", sitePres("s1", "SITE-ALPHA"), 40, 40);
    const menu = engine.getState().menu!;
    expect(menu.title).toContain("SITE ⊂ ANY");
    const labels = menu.items.map((i) => i.label);
    expect(labels).toContain("Compare Sites …");
    expect(labels).toContain("Reset Site");
    expect(labels).toContain("Describe");
    expect(labels).not.toContain("Set Update Interval"); // global
  });

  it("global menu lists global commands only", () => {
    const { engine } = makeEngine();
    engine.backgroundContext(10, 10);
    const labels = engine.getState().menu!.items.map((i) => i.label);
    expect(labels).toEqual(["Set Update Interval …"]);
  });
});

/* -------------------------------- coercions -------------------------------- */

describe("coercions", () => {
  it("lets a panel presentation satisfy an events argument", () => {
    const { engine, world } = makeEngine();
    engine.defineCoercion({
      from: "panel",
      to: "events",
      coerce: (p) => ({ type: "events", ref: p.ref, label: p.label }),
    });
    const panel: PresentationRecord = {
      id: "w1",
      type: "panel",
      ref: { kind: "panel", id: "w1" },
      label: "EVENTS-1",
    };
    expect(engine.applicableCommands(panel).map((c) => c.name)).toContain("Watch Task");
    engine.startCommand("Watch Task", panel);
    expect(world.log).toEqual(["watch via events"]);
  });
});

/* ------------------------------ command line ------------------------------- */

describe("command line", () => {
  it("prefix-matches multi-word names and parses positional args", () => {
    const { engine, world } = makeEngine();
    engine.submitCommandLine(":set update interval 200");
    expect(world.log).toEqual(["interval 200"]);
  });

  it("reports ambiguity", () => {
    const { engine, commands } = makeEngine();
    commands.define({ name: "Set Threshold", args: [], run: () => {} });
    engine.submitCommandLine("set");
    expect(transcriptText(engine).at(-1)).toContain("is ambiguous");
  });

  it("reports unknown commands", () => {
    const { engine } = makeEngine();
    engine.submitCommandLine("frobnicate");
    expect(transcriptText(engine).at(-1)).toBe("Unknown command: frobnicate");
  });

  it("offers completions", () => {
    const { engine } = makeEngine();
    expect(engine.completions("com")).toEqual(["Compare Sites"]);
  });
});

/* ------------------------------ adhoc accepts ------------------------------ */

describe("promise facade", () => {
  it("resolves with the supplied value", async () => {
    const { engine } = makeEngine();
    const p = engine.acceptAdhoc({ name: "victim", type: "site" });
    engine.gesture("click", sitePres("s3", "SITE-GAMMA"));
    await expect(p).resolves.toMatchObject({ label: "SITE-GAMMA" });
  });

  it("resolves null on abort", async () => {
    const { engine } = makeEngine();
    const p = engine.acceptAdhoc({ name: "victim", type: "site" });
    engine.escape();
    await expect(p).resolves.toBeNull();
  });
});

/* ------------------------------- doc line --------------------------------- */

describe("pointer doc and mode", () => {
  it("derives idle, hover, accepting and ineligible messages", () => {
    const { engine } = makeEngine();
    expect(pointerDoc(engine)).toBe(engine.idleDoc);
    expect(modeLabel(engine)).toBe("User Input");

    engine.gesture("enter", sitePres("s1", "SITE-ALPHA"));
    expect(pointerDoc(engine)).toContain("L: Reset Site");
    expect(pointerDoc(engine)).toContain("R: menu of 2 commands");

    engine.gesture("leave", sitePres("s1", "SITE-ALPHA"));
    engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    expect(modeLabel(engine)).toBe("Accept SITE");
    expect(pointerDoc(engine)).toContain("Accepting a SITE");

    engine.gesture("enter", sitePres("s2", "SITE-BETA"));
    expect(pointerDoc(engine)).toContain("L: use SITE-BETA");

    engine.gesture("enter", {
      id: "x", type: "panel", ref: { kind: "panel", id: "x" }, label: "P-1",
    });
    expect(pointerDoc(engine)).toContain("not applicable here");
  });
});

/* ---------------------------- transcript capping --------------------------- */

describe("transcript", () => {
  it("caps scrollback", () => {
    const { engine } = makeEngine();
    for (let i = 0; i < 350; i++) engine.print(`line ${i}`);
    expect(engine.transcript.lines().length).toBe(300);
    expect(transcriptText(engine)[0]).toBe("line 50");
  });
});

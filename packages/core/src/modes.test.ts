/* Participation modes + duringAccept (CLIM-JSX-005 §5) — the gating
 * matrix in executable form. */

import { describe, expect, it } from "vitest";
import {
  CommandTable,
  PbuiEngine,
  PTypes,
  defineBuiltinPtypes,
  pointerDoc,
  renderTranscript,
  type PresentationRecord,
  type Resolver,
} from "./index.js";

interface World {
  tab: string;
  log: string[];
  sites: Map<string, { id: string; name: string }>;
}

function makeEngine() {
  const world: World = {
    tab: "home",
    log: [],
    sites: new Map([
      ["s1", { id: "s1", name: "SITE-ALPHA" }],
      ["s2", { id: "s2", name: "SITE-BETA" }],
    ]),
  };
  const ptypes = new PTypes<World>();
  defineBuiltinPtypes(ptypes);
  ptypes.define({ name: "site" });
  ptypes.define({ name: "view" });
  const commands = new CommandTable<World>();
  commands.define({
    name: "Compare Sites",
    args: [
      { name: "site-a", type: "site" },
      { name: "site-b", type: "site", distinct: true },
    ],
    run: (args, api) => {
      api.world.log.push(`compare ${args["site-a"]!.label} ${args["site-b"]!.label}`);
    },
  });
  commands.define({
    name: "Switch To View",
    args: [{ name: "view", type: "view" }],
    isDefaultFor: ["view"],
    duringAccept: true,
    run: (args, api) => {
      api.world.tab = "id" in args["view"]!.ref ? args["view"]!.ref.id : "?";
      api.world.log.push(`switch ${args["view"]!.label}`);
    },
  });
  const resolver: Resolver = {
    resolve: (ref) => ("id" in ref ? world.sites.get(ref.id) ?? { id: ref.id } : undefined),
  };
  const engine = new PbuiEngine<World>({ ptypes, commands, world, resolver });
  return { engine, world };
}

const sitePres = (id: string, name: string): PresentationRecord => ({
  id: `p-${id}`,
  type: "site",
  ref: { kind: "site", id },
  label: name,
});

const viewPres = (id: string, mode?: PresentationRecord["mode"]): PresentationRecord => ({
  id: `v-${id}`,
  type: "view",
  ref: { kind: "view", id },
  label: id.toUpperCase(),
  mode,
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("define-time refusal (D2)", () => {
  it("rejects duringAccept commands that are not seed-complete", () => {
    const commands = new CommandTable();
    expect(() =>
      commands.define({
        name: "Bad",
        duringAccept: true,
        args: [
          { name: "a", type: "site" },
          { name: "b", type: "site" },
        ],
        run: () => {},
      }),
    ).toThrow(/seed-complete/);
    expect(() =>
      commands.define({
        name: "Also Bad",
        duringAccept: true,
        args: [{ name: "n", type: "number", input: "typed" }],
        run: () => {},
      }),
    ).toThrow(/seed-complete/);
  });
});

describe("gating matrix", () => {
  it("gated (default): ineligible clicks are swallowed mid-accept", () => {
    const { engine, world } = makeEngine();
    engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    engine.gesture("click", viewPres("orders")); // gated view
    expect(world.tab).toBe("home"); // nothing ran
    expect(engine.getState().accept).not.toBeNull(); // context intact
  });

  it("active + duringAccept: the command runs and the context SURVIVES", async () => {
    const { engine, world } = makeEngine();
    engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    engine.gesture("click", viewPres("orders", "active"));
    await tick();
    expect(world.tab).toBe("orders"); // ran
    const acc = engine.getState().accept;
    expect(acc).not.toBeNull(); // context intact
    expect(acc!.values["site-a"]!.label).toBe("SITE-ALPHA"); // args preserved
    // and the pending command still completes normally afterwards
    engine.gesture("click", sitePres("s2", "SITE-BETA"));
    expect(world.log).toEqual(["switch ORDERS", "compare SITE-ALPHA SITE-BETA"]);
  });

  it("active without a duringAccept default command: swallowed", () => {
    const { engine, world } = makeEngine();
    engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    // a site pres marked active: its default action is Describe (not duringAccept)
    engine.gesture("click", { ...sitePres("s1", "SITE-ALPHA"), id: "other", mode: "active" });
    expect(world.log).toEqual([]);
    expect(engine.getState().accept).not.toBeNull();
  });

  it("right-click on an active presentation opens the reduced menu instead of aborting", () => {
    const { engine } = makeEngine();
    engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    engine.gesture("context", viewPres("orders", "active"), 10, 10);
    const menu = engine.getState().menu;
    expect(engine.getState().accept).not.toBeNull(); // NOT aborted
    expect(menu?.items.map((i) => i.label)).toEqual(["Switch To View"]);
  });

  it("right-click elsewhere mid-accept still aborts", () => {
    const { engine } = makeEngine();
    engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    engine.gesture("context", viewPres("orders"), 10, 10);
    expect(engine.getState().accept).toBeNull();
    expect(renderTranscript(engine.transcript.lines())).toContain("[Abort]");
  });

  it("eligible presentations supply regardless of mode", () => {
    const { engine, world } = makeEngine();
    engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    engine.gesture("click", { ...sitePres("s2", "SITE-BETA"), mode: "active" });
    expect(world.log).toEqual(["compare SITE-ALPHA SITE-BETA"]);
  });

  it("doc line narrates the active affordance", () => {
    const { engine } = makeEngine();
    engine.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    engine.gesture("enter", viewPres("orders", "active"));
    expect(pointerDoc(engine)).toContain("L: Switch To View (the pending Compare Sites keeps waiting)");
    engine.gesture("enter", viewPres("orders"));
    expect(pointerDoc(engine)).toContain("not applicable here");
  });
});

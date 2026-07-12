/* Shared test fixture: the same site-world as core's core.test.ts, plus a
 * full TestApp tree (provider + presentations + chrome + listener) rendered
 * with React Testing Library. */

import {
  CommandTable,
  PbuiEngine,
  PTypes,
  defineBuiltinPtypes,
  valueRef,
  type PresentationRecord,
  type Resolver,
} from "@pbui/core";
import { ContextMenuHost, MouseDocBar } from "@pbui/chrome";
import { Listener } from "@pbui/listener";
import { PbuiProvider, Presentation } from "../index.js";

export interface Site {
  id: string;
  name: string;
  load: number;
}

export interface World {
  sites: Map<string, Site>;
  log: string[];
}

export function makeWorld(): World {
  const sites = new Map<string, Site>();
  for (const [id, name] of [
    ["s1", "SITE-ALPHA"],
    ["s2", "SITE-BETA"],
    ["s3", "SITE-GAMMA"],
  ] as const)
    sites.set(id, { id, name, load: 10 });
  return { sites, log: [] };
}

export function makeEngine(world = makeWorld()) {
  const ptypes = new PTypes<World>();
  defineBuiltinPtypes(ptypes);
  ptypes.define<Site>({
    name: "site",
    // strict on purpose: printers dereference their object, so the doc line
    // and describe must always resolve before printing
    print: (s) => `#<SITE ${s.name}>`,
    parse: (text, w) => {
      const t = text.trim().toUpperCase();
      for (const s of w.sites.values()) {
        if (s.name === t || s.name.startsWith(t))
          return { ok: true, value: s, ref: { kind: "site", id: s.id }, label: s.name };
      }
      return { ok: false, err: `${text} does not name a SITE` };
    },
  });
  ptypes.define({ name: "panel" });

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
    name: "Reset Site",
    args: [{ name: "site", type: "site" }],
    isDefaultFor: ["site"],
    run: (args, api) => {
      api.world.log.push(`reset ${args["site"]!.label}`);
    },
  });
  commands.define({
    name: "Set Update Interval",
    global: true,
    args: [
      {
        name: "interval",
        type: "number",
        input: "typed",
        default: () => ({ type: "number", ref: valueRef(650), label: "650" }),
      },
    ],
    run: (args, api) => {
      api.world.log.push(`interval ${args["interval"]!.label}`);
    },
  });

  const resolver: Resolver = {
    resolve: (ref) =>
      "id" in ref && ref.kind === "site" ? world.sites.get(ref.id) : undefined,
  };
  const engine = new PbuiEngine<World>({ ptypes, commands, world, resolver });
  return { engine, world, ptypes, commands };
}

/** a synthetic presentation record for seeding commands, as in core.test.ts */
export function sitePres(id: string, name: string): PresentationRecord {
  return { id: `seed-${id}`, type: "site", ref: { kind: "site", id }, label: name };
}

export function transcriptText(engine: PbuiEngine<World>): string[] {
  return engine.transcript
    .lines()
    .map((l) => l.parts.map((p) => ("s" in p ? p.s : p.label)).join(""));
}

/** Full app under test: a quiet-free "panel" container presentation wrapping
 * one site presentation per world site, plus the chrome and the listener. */
export function TestApp(props: { engine: PbuiEngine<World>; prompt?: string }) {
  return (
    <PbuiProvider engine={props.engine}>
      <div data-testid="stage">
        <Presentation
          type="panel"
          object={{ kind: "panel", id: "main" }}
          label="PANEL-MAIN"
          block
        >
          <Presentation type="site" object={{ kind: "site", id: "s1" }} label="SITE-ALPHA">
            SITE-ALPHA
          </Presentation>
          <Presentation type="site" object={{ kind: "site", id: "s2" }} label="SITE-BETA">
            SITE-BETA
          </Presentation>
          <Presentation type="site" object={{ kind: "site", id: "s3" }} label="SITE-GAMMA">
            SITE-GAMMA
          </Presentation>
        </Presentation>
      </div>
      <ContextMenuHost />
      <MouseDocBar />
      <Listener prompt={props.prompt} />
    </PbuiProvider>
  );
}

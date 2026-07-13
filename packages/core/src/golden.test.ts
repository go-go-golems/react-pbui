/* Golden-transcript tests: scripted engine interactions rendered to text
 * and compared against checked-in .txt files. Regenerate deliberately with
 *   GOLDEN_UPDATE=1 pnpm --filter @go-go-golems/pbui-core test
 * and review the diff like a snapshot. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CommandTable,
  PbuiEngine,
  PTypes,
  defineBuiltinPtypes,
  valueRef,
  type PresentationRecord,
  type Resolver,
} from "./index.js";
import { renderTranscript } from "./transcript-text.js";

const here = dirname(fileURLToPath(import.meta.url));
const goldenDir = join(here, "__golden__");

function checkGolden(name: string, actual: string): void {
  const file = join(goldenDir, name);
  if (process.env["GOLDEN_UPDATE"] || !existsSync(file)) {
    mkdirSync(goldenDir, { recursive: true });
    writeFileSync(file, actual);
    if (!process.env["GOLDEN_UPDATE"] && !existsSync(file))
      throw new Error(`golden ${name} was missing; wrote it — rerun`);
    return;
  }
  expect(actual).toBe(readFileSync(file, "utf8"));
}

/* fixture: a tiny world with two arg styles */

interface Site {
  id: string;
  name: string;
}

function makeEngine() {
  const sites = new Map<string, Site>([
    ["s1", { id: "s1", name: "SITE-ALPHA" }],
    ["s2", { id: "s2", name: "SITE-BETA" }],
  ]);
  const world = { sites, log: [] as string[] };
  const ptypes = new PTypes<typeof world>();
  defineBuiltinPtypes(ptypes);
  ptypes.define<Site>({
    name: "site",
    print: (s) => `#<SITE ${s.name}>`,
    parse: (text, w) => {
      const t = text.trim().toUpperCase();
      for (const s of w.sites.values())
        if (s.name.startsWith(t))
          return { ok: true, value: s, ref: { kind: "site", id: s.id }, label: s.name };
      return { ok: false, err: `${text} does not name a SITE` };
    },
  });
  const commands = new CommandTable<typeof world>();
  commands.define({
    name: "Compare Sites",
    args: [
      { name: "site-a", type: "site" },
      { name: "site-b", type: "site", distinct: true },
    ],
    run: (args, api) => {
      api.print("Compared ", { t: "pres", type: "site", ref: args["site-a"]!.ref, label: args["site-a"]!.label }, " with ", { t: "bold", s: args["site-b"]!.label }, ".");
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
        validate: (v) =>
          "value" in v.ref && (v.ref.value as number) >= 100
            ? true
            : "interval must be at least 100",
      },
    ],
    run: (args, api) => {
      api.print(`Interval set to ${args["interval"]!.label}.`);
    },
  });
  const resolver: Resolver = {
    resolve: (ref) => ("id" in ref ? sites.get(ref.id) : undefined),
  };
  return new PbuiEngine({ ptypes, commands, world, resolver });
}

const sitePres = (id: string, name: string): PresentationRecord => ({
  id: `t-${id}`,
  type: "site",
  ref: { kind: "site", id },
  label: name,
});

describe("golden transcripts", () => {
  it("compare-sites: seed, supply by click, output parts", () => {
    const e = makeEngine();
    e.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    e.gesture("click", sitePres("s2", "SITE-BETA"));
    checkGolden("compare-sites.txt", renderTranscript(e.transcript.lines()));
  });

  it("abort-everywhere: escape at each stage, distinct rejection", () => {
    const e = makeEngine();
    e.startCommand("Compare Sites");
    e.escape();
    e.startCommand("Compare Sites", sitePres("s1", "SITE-ALPHA"));
    e.supplyValue({ type: "site", ref: { kind: "site", id: "s1" }, label: "SITE-ALPHA" });
    e.escape();
    e.startCommand("Set Update Interval");
    e.escape();
    checkGolden("abort-everywhere.txt", renderTranscript(e.transcript.lines()));
  });

  it("command-line: prefix match, positional parse, validation, defaults", () => {
    const e = makeEngine();
    e.submitCommandLine("compare sites site-a site-b");
    e.submitCommandLine("set update interval 50");
    e.submitCommandLine("set update interval 300");
    e.startCommand("Set Update Interval");
    e.submitTyped(""); // take the default
    e.submitCommandLine("frobnicate");
    checkGolden("command-line.txt", renderTranscript(e.transcript.lines()));
  });
});

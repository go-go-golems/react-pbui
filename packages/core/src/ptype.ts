/* Presentation types (ptypes): a named lattice with per-type codecs.
 *
 * Types form a parent lattice ("milestone" ⊂ "task" ⊂ ...); "any" is the
 * implicit top. Each type may carry a printer, a keyboard parser (the two
 * halves of the round-trip codec, aitr-794.md:856-880), a describer, and
 * the name of its default left-click command.
 */

import type { ObjectRef, OutputPart, PartLike } from "./types.js";

export type ParseResult<T = unknown> =
  | { ok: true; value: T; ref: ObjectRef; label: string }
  | { ok: false; err: string };

export interface PTypeSpec<T = unknown, W = unknown> {
  name: string;
  /** direct supertypes; omitted = child of "any" */
  supertypes?: string[];
  /** printed representation, e.g. `#<TASK T-3>` */
  print?: (obj: T) => string;
  /** keyboard half of accept: parse typed text against the world */
  parse?: (text: string, world: W) => ParseResult<T>;
  /** rich Describe output; falls back to the printed representation */
  describe?: (obj: T, world: W) => PartLike[];
  /** command started on plain left-click outside an input context */
  defaultCommand?: string;
}

export interface PType<T = unknown, W = unknown> extends PTypeSpec<T, W> {
  supertypes: string[];
}

export class PTypes<W = unknown> {
  private byName = new Map<string, PType<unknown, W>>();

  define<T>(spec: PTypeSpec<T, W>): PType<T, W> {
    if (spec.name === "any") throw new Error(`"any" is reserved`);
    const t: PType<T, W> = { ...spec, supertypes: spec.supertypes ?? [] };
    for (const s of t.supertypes) {
      if (s !== "any" && !this.byName.has(s))
        throw new Error(`unknown supertype "${s}" of "${spec.name}"`);
    }
    // reject cycles (supertypes must already exist, so cycles are impossible
    // by construction, but guard against self-reference)
    if (t.supertypes.includes(spec.name))
      throw new Error(`ptype "${spec.name}" cannot be its own supertype`);
    this.byName.set(spec.name, t as PType<unknown, W>);
    return t;
  }

  get(name: string): PType<unknown, W> | undefined {
    return this.byName.get(name);
  }

  /** is `t` a subtype of `want`? Everything is a subtype of "any". */
  subtypep(t: string, want: string): boolean {
    if (want === "any" || t === want) return true;
    const seen = new Set<string>();
    const stack = [t];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === want) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const def = this.byName.get(cur);
      if (def) stack.push(...def.supertypes);
    }
    return false;
  }

  /** ["milestone","task","any"] — first parent chain, for lattice display */
  latticePath(t: string): string[] {
    const chain = [t];
    let cur = this.byName.get(t);
    while (cur && cur.supertypes.length > 0) {
      const parent = cur.supertypes[0]!;
      chain.push(parent);
      cur = this.byName.get(parent);
    }
    if (chain[chain.length - 1] !== "any") chain.push("any");
    return chain;
  }

  /** "MILESTONE ⊂ TASK ⊂ ANY" — the context-menu title convention */
  latticeLabel(t: string): string {
    return this.latticePath(t)
      .map((x) => x.toUpperCase())
      .join(" ⊂ ");
  }

  print(type: string, obj: unknown, label?: string): string {
    const def = this.byName.get(type);
    if (def?.print && obj !== undefined) {
      try {
        return def.print(obj);
      } catch {
        // fall through to the generic form on printer errors
      }
    }
    return `#<${type.toUpperCase()}${label ? " " + label : ""}>`;
  }
}

/* ------------------------- built-in argument ptypes ----------------------- */

import { valueRef } from "./types.js";

/** Register the "number" and "string" argument ptypes used by typed input. */
export function defineBuiltinPtypes<W>(ptypes: PTypes<W>): void {
  ptypes.define<number>({
    name: "number",
    print: (n) => String(n),
    parse: (text) => {
      const n = Number(text.trim());
      if (text.trim() === "" || Number.isNaN(n))
        return { ok: false, err: `${text.trim() || "??"} is not a valid NUMBER` };
      return { ok: true, value: n, ref: valueRef(n), label: String(n) };
    },
  });
  ptypes.define<string>({
    name: "string",
    print: (s) => JSON.stringify(s),
    parse: (text) => {
      const s = text.trim();
      if (!s) return { ok: false, err: "empty STRING" };
      return { ok: true, value: s, ref: valueRef(s), label: s };
    },
  });
}

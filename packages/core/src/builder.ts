/* The typed command builder (CLIM-JSX-004 §5).
 *
 * Argument descriptors carry the TypeScript type of the value a command
 * body will receive; the builder compiles them into the existing
 * CommandSpec/ArgSpec runtime (command.ts) and wraps `run` with
 * resolve-then-run: entity refs are resolved through the engine's
 * Resolver, value refs are unwrapped, and any stale entity aborts the
 * command centrally with the standardized message — command bodies never
 * see an ObjectRef again.
 *
 * Design decisions D1 (compile-to-v1) and D2 (resolve-then-run) of the
 * CLIM-JSX-004 design doc.
 */

import type {
  ArgSpec,
  Choice,
  CommandApi,
  CommandSpec,
  ResolveFn,
} from "./command.js";
import { CommandTable } from "./command.js";
import type {
  ArgValue,
  ArgValues,
  PartLike,
  PresentationRecord,
} from "./types.js";
import { valueRef } from "./types.js";

/* ------------------------------ descriptors ------------------------------- */

type SoFar<A> = Partial<ResolvedArgs<A>>;

export interface PresOpts<T, A, W> {
  prompt?: string;
  distinct?: boolean;
  /** receive T | undefined instead of aborting on stale entities */
  allowStale?: boolean;
  where?: (candidate: T, soFar: SoFar<A>, world: W) => boolean;
  validate?: (value: T, soFar: SoFar<A>, world: W) => true | string;
}

export interface TextOpts<A, W> {
  prompt?: string;
  default?: string | ((soFar: SoFar<A>, world: W) => string);
  validate?: (value: string, soFar: SoFar<A>, world: W) => true | string;
}

export interface NumOpts<A, W> {
  prompt?: string;
  default?: number | ((soFar: SoFar<A>, world: W) => number);
  min?: number;
  max?: number;
  integer?: boolean;
  validate?: (value: number, soFar: SoFar<A>, world: W) => true | string;
}

export interface ChoiceOpts<T extends string, A, W> {
  prompt?: string;
  options: (soFar: SoFar<A>, world: W) => { label: string; value: T }[];
}

export interface ArgDesc<T = unknown> {
  readonly ptype: string;
  readonly kind: "presentation" | "text" | "number" | "choice";
  /** builder-level callbacks, wrapped during compilation */
  readonly opts: Record<string, unknown>;
  /** phantom carrier for the resolved value type */
  readonly __t?: T;
}

/* the arg namespace — deliberately monomorphic for readable type errors */
export const arg = {
  /** an object supplied by pointing (or via the ptype's parse) */
  presentation<T>(ptype: string, opts: PresOpts<T, any, any> = {}): ArgDesc<T> {
    return { ptype, kind: "presentation", opts: opts as Record<string, unknown> };
  },
  /** typed text -> string */
  text(opts: TextOpts<any, any> = {}): ArgDesc<string> {
    return { ptype: "string", kind: "text", opts: opts as Record<string, unknown> };
  },
  /** typed text -> number, with range/integer sugar */
  number(opts: NumOpts<any, any> = {}): ArgDesc<number> {
    return { ptype: "number", kind: "number", opts: opts as Record<string, unknown> };
  },
  /** menu choice over a closed string set */
  choice<T extends string>(opts: ChoiceOpts<T, any, any>): ArgDesc<T> {
    return { ptype: "string", kind: "choice", opts: opts as unknown as Record<string, unknown> };
  },
};

export type ResolvedArgs<A> = {
  [K in keyof A]: A[K] extends ArgDesc<infer T> ? T : never;
};

export interface BuiltCommand<A extends Record<string, ArgDesc<any>>, W> {
  name: string;
  doc?: string;
  /** insertion order of keys = accept order; key = display name */
  args?: A;
  /** applicability, with the first argument already resolved */
  appliesTo?: (first: ResolvedArgs<A>[keyof A], world: W) => boolean;
  isDefaultFor?: string[];
  global?: boolean;
  hidden?: boolean;
  run: (args: ResolvedArgs<A>, api: CommandApi<W>) => void | Promise<void>;
}

/* ------------------------------- resolution -------------------------------- */

const STALE = (label: string): PartLike =>
  `${label} no longer exists — presentation was stale;`;

function resolveOne(
  desc: ArgDesc,
  v: ArgValue,
  resolve: ResolveFn,
): { ok: true; value: unknown } | { ok: false; staleLabel: string } {
  if ("value" in v.ref) {
    // immediates: unwrap; number descriptors coerce
    const raw = v.ref.value;
    return { ok: true, value: desc.kind === "number" ? Number(raw) : raw };
  }
  const obj = resolve(v.ref);
  if (obj === undefined && !desc.opts["allowStale"])
    return { ok: false, staleLabel: v.label };
  return { ok: true, value: obj };
}

function resolveAll(
  descs: [string, ArgDesc][],
  values: ArgValues,
  resolve: ResolveFn,
): { ok: true; resolved: Record<string, unknown> } | { ok: false; staleLabel: string } {
  const resolved: Record<string, unknown> = {};
  for (const [name, desc] of descs) {
    const v = values[name];
    if (v === undefined) continue; // partial (soFar) resolution
    const r = resolveOne(desc, v, resolve);
    if (!r.ok) return r;
    resolved[name] = r.value;
  }
  return { ok: true, resolved };
}

/* ------------------------------- compilation ------------------------------- */

function compileArg<W>(
  name: string,
  desc: ArgDesc,
  allDescs: [string, ArgDesc][],
): ArgSpec {
  const opts = desc.opts;
  const soFarOf = (values: ArgValues, resolve: ResolveFn | undefined) => {
    if (!resolve) return {};
    const r = resolveAll(allDescs, values, resolve);
    return r.ok ? r.resolved : {};
  };

  const spec: ArgSpec = { name, type: desc.ptype };
  if (opts["prompt"]) spec.prompt = opts["prompt"] as string;
  if (opts["distinct"]) spec.distinct = true;

  if (desc.kind === "presentation") {
    if (opts["where"]) {
      const where = opts["where"] as (c: unknown, s: unknown, w: unknown) => boolean;
      spec.where = (pres: PresentationRecord, soFar, world, resolve) => {
        if (!resolve) return true;
        const r = resolveOne(desc, { type: pres.type, ref: pres.ref, label: pres.label }, resolve);
        if (!r.ok) return false;
        return where(r.value, soFarOf(soFar, resolve), world);
      };
    }
    if (opts["validate"]) {
      const validate = opts["validate"] as (v: unknown, s: unknown, w: unknown) => true | string;
      spec.validate = (v, soFar, world, resolve) => {
        if (!resolve) return true;
        const r = resolveOne(desc, v, resolve);
        if (!r.ok) return `${v.label} no longer exists`;
        return validate(r.value, soFarOf(soFar, resolve), world);
      };
    }
    return spec;
  }

  if (desc.kind === "choice") {
    spec.input = "menu";
    const options = opts["options"] as (s: unknown, w: unknown) => { label: string; value: string }[];
    spec.options = (soFar, world, resolve): Choice[] =>
      options(soFarOf(soFar, resolve), world).map((c) => ({
        label: c.label,
        ref: valueRef(c.value),
      }));
    return spec;
  }

  // text / number
  spec.input = "typed";
  const dflt = opts["default"];
  if (dflt !== undefined) {
    spec.default = (soFar, world, resolve) => {
      const raw = typeof dflt === "function"
        ? (dflt as (s: unknown, w: unknown) => unknown)(soFarOf(soFar, resolve), world)
        : dflt;
      return { type: desc.ptype, ref: valueRef(raw), label: String(raw) };
    };
  }
  const userValidate = opts["validate"] as
    | ((v: unknown, s: unknown, w: unknown) => true | string)
    | undefined;
  const { min, max, integer } = opts as { min?: number; max?: number; integer?: boolean };
  if (userValidate || min !== undefined || max !== undefined || integer) {
    spec.validate = (v, soFar, world, resolve) => {
      const raw = "value" in v.ref ? v.ref.value : undefined;
      if (desc.kind === "number") {
        const n = Number(raw);
        if (integer && !Number.isInteger(n)) return `${name} must be an integer`;
        if (min !== undefined && n < min) return `${name} must be at least ${min}`;
        if (max !== undefined && n > max) return `${name} must be at most ${max}`;
        if (userValidate) return userValidate(n, soFarOf(soFar, resolve ?? (() => undefined)), world);
        return true;
      }
      if (userValidate)
        return userValidate(String(raw), soFarOf(soFar, resolve ?? (() => undefined)), world);
      return true;
    };
  }
  return spec;
}

/* -------------------------------- the builder ------------------------------ */

export class CommandBuilder<W> {
  constructor(private table: CommandTable<W>) {}

  define<A extends Record<string, ArgDesc<any>>>(built: BuiltCommand<A, W>): CommandSpec<W> {
    const descs = Object.entries(built.args ?? {}) as [string, ArgDesc][];
    const argSpecs = descs.map(([name, d]) => compileArg<W>(name, d, descs));

    const spec: CommandSpec<W> = {
      name: built.name,
      doc: built.doc,
      args: argSpecs,
      isDefaultFor: built.isDefaultFor,
      global: built.global,
      hidden: built.hidden,
      run: async (values, api) => {
        const r = resolveAll(descs, values, (ref) => api.resolve({ type: "", ref, label: "" }));
        if (!r.ok) {
          api.fail(STALE(r.staleLabel));
          return;
        }
        await built.run(r.resolved as ResolvedArgs<A>, api);
      },
    };

    if (built.appliesTo) {
      const appliesTo = built.appliesTo as (first: unknown, world: W) => boolean;
      const firstDesc = descs[0]?.[1];
      spec.appliesTo = (pres, world, resolve) => {
        if (!firstDesc || !resolve) return true;
        const r = resolveOne(
          firstDesc,
          { type: pres.type, ref: pres.ref, label: pres.label },
          resolve,
        );
        if (!r.ok) return false;
        return appliesTo(r.value, world);
      };
    }

    this.table.define(spec);
    return spec;
  }

  defineAll<A extends Record<string, ArgDesc<any>>>(builts: BuiltCommand<A, W>[]): void {
    for (const b of builts) this.define(b);
  }
}

export function commandBuilder<W>(table: CommandTable<W>): CommandBuilder<W> {
  return new CommandBuilder(table);
}

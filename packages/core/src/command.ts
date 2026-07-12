/* Command tables: commands as data (the converged corpus shape, §6.4).
 *
 * Commands declare typed arguments; menus, prompting, the mouse-doc line
 * and the command line all derive from these declarations. Command bodies
 * receive an injected CommandApi and never touch UI state directly
 * (care-examiner's capability-facade rule).
 */

import type { ArgValue, ArgValues, ObjectRef, PartLike, PresentationRecord } from "./types.js";

export interface Choice {
  label: string;
  ref: ObjectRef;
}

/** engine-supplied ref resolution, passed to spec callbacks so layered
 * authoring APIs (the typed builder) can hand user code live objects */
export type ResolveFn = (ref: ObjectRef) => unknown | undefined;

export interface ArgSpec {
  name: string;
  /** ptype name; "number"/"string" use typed input by default */
  type: string;
  /** how the value is acquired; default: "presentation" for object ptypes,
   * "typed" for ptypes with a parse function and no on-screen instances */
  input?: "presentation" | "typed" | "menu";
  prompt?: string;
  /** dependent choices for menu-valued args (design-kit.jsx:253) */
  options?: (soFar: ArgValues, world: unknown, resolve?: ResolveFn) => Choice[];
  /** CLIM-style default, offered as `[default …]` and taken on empty Enter */
  default?: (soFar: ArgValues, world: unknown, resolve?: ResolveFn) => ArgValue | undefined;
  /** must differ from every previously collected arg (scheduler:296) */
  distinct?: boolean;
  /** extra predicate on candidate presentations (e.g. port direction) */
  where?: (pres: PresentationRecord, soFar: ArgValues, world: unknown, resolve?: ResolveFn) => boolean;
  /** validate a supplied value; return an error string to reject */
  validate?: (v: ArgValue, soFar: ArgValues, world: unknown, resolve?: ResolveFn) => true | string;
}

export interface CommandApi<W> {
  print: (...parts: PartLike[]) => void;
  printErr: (...parts: PartLike[]) => void;
  /** standardized command failure ("<reason> <Command> aborted.") */
  fail: (...parts: PartLike[]) => void;
  /** opt this invocation into undo: capture runs now, returns the inverse */
  undoable: (capture: () => () => void | Promise<void>) => void;
  /** snapshot-undo sugar for immutable stores: undo restores the pre-run state */
  snapshotUndo: <S>(store: { get(): S; set(state: S): void }) => void;
  world: W;
  /** resolve a collected ArgValue to the live domain object (undefined = stale) */
  resolve: (v: ArgValue) => unknown | undefined;
  /** mid-body accept (promise facade, D6); null on abort */
  accept: (spec: ArgSpec) => Promise<ArgValue | null>;
  /** invoke another command, optionally with preset args (command chaining) */
  invoke: (name: string, preset?: ArgValues) => void;
}

export interface CommandSpec<W = unknown> {
  name: string;
  doc?: string;
  args?: ArgSpec[];
  /** extra applicability beyond first-arg type matching (metrics(2):1043) */
  appliesTo?: (pres: PresentationRecord, world: W, resolve?: ResolveFn) => boolean;
  /** ptypes this command is the left-click default for; first match wins */
  isDefaultFor?: string[];
  /** reachable from the background menu / command line only */
  global?: boolean;
  /** hide from menus entirely (command line only) */
  hidden?: boolean;
  run: (args: ArgValues, api: CommandApi<W>) => void | Promise<void>;
}

export class CommandTable<W = unknown> {
  private list: CommandSpec<W>[] = [];
  private byName = new Map<string, CommandSpec<W>>();

  define(spec: CommandSpec<W>): CommandSpec<W> {
    if (this.byName.has(spec.name))
      throw new Error(`duplicate command "${spec.name}"`);
    this.list.push(spec);
    this.byName.set(spec.name, spec);
    return spec;
  }

  defineAll(specs: CommandSpec<W>[]): void {
    for (const s of specs) this.define(s);
  }

  get(name: string): CommandSpec<W> | undefined {
    return this.byName.get(name);
  }

  all(): CommandSpec<W>[] {
    return [...this.list];
  }

  /** case-insensitive exact-then-prefix match; reports ambiguity */
  match(text: string):
    | { kind: "found"; cmd: CommandSpec<W> }
    | { kind: "ambiguous"; names: string[] }
    | { kind: "none" } {
    const t = text.trim().toLowerCase().replace(/^:/, "");
    if (!t) return { kind: "none" };
    const exact = this.list.find((c) => c.name.toLowerCase() === t);
    if (exact) return { kind: "found", cmd: exact };
    const hits = this.list.filter((c) => c.name.toLowerCase().startsWith(t));
    if (hits.length === 1) return { kind: "found", cmd: hits[0]! };
    if (hits.length > 1)
      return { kind: "ambiguous", names: hits.map((c) => c.name) };
    return { kind: "none" };
  }

  completions(text: string): string[] {
    const t = text.trim().toLowerCase().replace(/^:/, "");
    return this.list
      .filter((c) => c.name.toLowerCase().startsWith(t))
      .map((c) => c.name);
  }
}

export function firstArg<W>(cmd: CommandSpec<W>): ArgSpec | undefined {
  return cmd.args?.[0];
}

/** does this command's first argument accept objects supplied by pointing? */
export function takesPresentationFirst<W>(cmd: CommandSpec<W>): boolean {
  const a = firstArg(cmd);
  return !!a && (a.input ?? "presentation") === "presentation";
}

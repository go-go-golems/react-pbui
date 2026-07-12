/* PbuiEngine: the framework-free interaction engine.
 *
 * Owns the accept-loop state machine (advance / startCommand / supply /
 * abort), gesture routing, menu derivation, coercions, describe, the echo
 * grammar, and the typed-input/command-line paths. React (or anything else)
 * subscribes and renders; nothing here touches the DOM.
 */

import type {
  ArgValue,
  ArgValues,
  ObjectRef,
  PartLike,
  PresentationRecord,
  Unsubscribe,
} from "./types.js";
import { refEquals, toPart, B, S } from "./types.js";
import type { ArgSpec, CommandApi, CommandSpec } from "./command.js";
import { CommandTable, takesPresentationFirst } from "./command.js";
import { PTypes } from "./ptype.js";
import { PresentationRegistry } from "./registry.js";
import { Transcript } from "./transcript.js";
import { InvocationLog } from "./invocation.js";
import type { Resolver } from "./types.js";

/* ------------------------------- state types ------------------------------ */

export interface AcceptState {
  /** command being filled; null for an ad-hoc api.accept() */
  cmd: CommandSpec<any> | null;
  values: ArgValues;
  spec: ArgSpec;
  resolveAdhoc?: (v: ArgValue | null) => void;
}

export interface MenuItem {
  label: string;
  doc?: string;
  disabled?: boolean;
  run: () => void;
}

export interface MenuState {
  x: number;
  y: number;
  title: string;
  items: MenuItem[];
}

export interface EngineState {
  accept: AcceptState | null;
  hover: PresentationRecord | null;
  menu: MenuState | null;
  pointer: { x: number; y: number };
}

export interface Coercion {
  from: string;
  to: string;
  coerce: (pres: PresentationRecord) => ArgValue;
}

export interface EngineOptions<W> {
  ptypes: PTypes<W>;
  commands: CommandTable<W>;
  world: W;
  resolver: Resolver;
  transcriptCap?: number;
  /** idle mouse-doc line text */
  idleDoc?: string;
}

export type GestureKind = "click" | "aux" | "context" | "enter" | "leave";

/* --------------------------------- engine --------------------------------- */

export class PbuiEngine<W = unknown> {
  readonly ptypes: PTypes<W>;
  readonly commands: CommandTable<W>;
  readonly registry = new PresentationRegistry();
  readonly transcript: Transcript;
  readonly world: W;
  readonly resolver: Resolver;
  readonly idleDoc: string;

  /** every executed command, with lifecycle state (CLIM-JSX-004 §7) */
  readonly invocations = new InvocationLog();

  /** transcript echo line awaiting its invocation (set by startCommand*) */
  private pendingEchoLineId: string | undefined;

  /** bound resolver passthrough handed to spec callbacks (ResolveFn).
   * Invocation refs resolve from the engine's own log; everything else
   * delegates to the app resolver. */
  readonly resolveFn = (ref: ObjectRef): unknown | undefined => {
    if ("id" in ref && ref.kind === "invocation") return this.invocations.byId(ref.id);
    return this.resolver.resolve(ref);
  };

  private coercions: Coercion[] = [];
  private listeners = new Set<() => void>();
  /** ids of registered presentations eligible for the current accept
   * (CLIM-JSX-005 §6.3); null when no accept is active */
  private eligibleIds: Set<string> | null = null;
  private state: EngineState = {
    accept: null,
    hover: null,
    menu: null,
    pointer: { x: 0, y: 0 },
  };

  constructor(opts: EngineOptions<W>) {
    this.ptypes = opts.ptypes;
    this.commands = opts.commands;
    this.world = opts.world;
    this.resolver = opts.resolver;
    this.transcript = new Transcript(opts.transcriptCap ?? 300);
    this.idleDoc =
      opts.idleDoc ??
      "Mouse-L: default action; Mouse-M: Describe; Mouse-R: menu of commands.";
    // presentations registered mid-accept (e.g. transcript prints) join the
    // eligible set incrementally — no full recompute on the hot path
    this.registry.subscribe((ev) => {
      if (!this.eligibleIds) return;
      if (ev.kind === "unregister") {
        this.eligibleIds.delete(ev.id);
        return;
      }
      if (this.eligibleUncached(ev.rec)) this.eligibleIds.add(ev.rec.id);
      else this.eligibleIds.delete(ev.rec.id);
      this.registry.notifyPres(ev.rec.id);
    });
  }

  /* ------------------------------ subscription ----------------------------- */

  getState(): EngineState {
    return this.state;
  }

  subscribe(fn: () => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** hover transitions notify exactly the affected presentations: the old
   * and new hover targets plus every presentation of the same objects
   * (related-hover outlines). This is the mouse-frequency hot path. */
  private setHover(next: PresentationRecord | null): void {
    const prev = this.state.hover;
    if (prev?.id === next?.id) {
      if (next) this.setState({ hover: next });
      return;
    }
    this.setState({ hover: next });
    const affected = new Set<string>();
    for (const p of [prev, next]) {
      if (!p) continue;
      affected.add(p.id);
      for (const r of this.registry.byRef(p.ref)) affected.add(r.id);
    }
    for (const id of affected) this.registry.notifyPres(id);
  }

  /* -------------------------------- printing ------------------------------- */

  print(...parts: PartLike[]): void {
    this.transcript.out(...parts);
  }
  printErr(...parts: PartLike[]): void {
    this.transcript.err(...parts);
  }

  /** standardized command failure (stale arguments etc.): prints the error;
   * the invocation log (CLIM-JSX-004 §7) also records it once it exists */
  failInvocation(cmdName: string, ...reason: PartLike[]): void {
    this.transcript.err(...reason, ` ${cmdName} aborted.`);
  }

  /* ------------------------------- coercions ------------------------------- */

  defineCoercion(c: Coercion): void {
    this.coercions.push(c);
  }

  /** turn a presentation into the ArgValue a spec wants, or null */
  private coerceFor(spec: ArgSpec, pres: PresentationRecord): ArgValue | null {
    if (this.ptypes.subtypep(pres.type, spec.type)) {
      return { type: pres.type, ref: pres.ref, label: pres.label };
    }
    for (const c of this.coercions) {
      if (
        this.ptypes.subtypep(pres.type, c.from) &&
        this.ptypes.subtypep(c.to, spec.type)
      ) {
        return c.coerce(pres);
      }
    }
    return null;
  }

  /* ------------------------------ eligibility ------------------------------ */

  /** the full predicate — used to (re)build the cache and for ad-hoc
   * (unregistered) records such as test fixtures */
  private eligibleUncached(pres: Pick<PresentationRecord, "type" | "ref" | "label">): boolean {
    const acc = this.state.accept;
    if (!acc) return false;
    const rec = pres as PresentationRecord;
    const v = this.coerceFor(acc.spec, rec);
    if (!v) return false;
    if (acc.spec.where && !acc.spec.where(rec, acc.values, this.world, this.resolveFn))
      return false;
    if (acc.spec.distinct) {
      for (const prev of Object.values(acc.values))
        if (refEquals(prev.ref, v.ref)) return false;
    }
    return true;
  }

  /** would clicking this presentation supply the currently wanted arg?
   * O(1) for registered presentations via the eligible-set cache. */
  eligible(
    pres: Pick<PresentationRecord, "type" | "ref" | "label"> & { id?: string },
  ): boolean {
    if (!this.state.accept) return false;
    if (pres.id && this.eligibleIds && this.registry.get(pres.id))
      return this.eligibleIds.has(pres.id);
    return this.eligibleUncached(pres);
  }

  /** registered presentations eligible right now (keyboard Tab-cycling) */
  eligibleList(): PresentationRecord[] {
    if (!this.eligibleIds) return [];
    const out: PresentationRecord[] = [];
    for (const id of this.eligibleIds) {
      const r = this.registry.get(id);
      if (r) out.push(r);
    }
    return out;
  }

  private recomputeEligible(): void {
    if (!this.state.accept) {
      this.eligibleIds = null;
      return;
    }
    const ids = new Set<string>();
    for (const rec of this.registry.all())
      if (this.eligibleUncached(rec)) ids.add(rec.id);
    this.eligibleIds = ids;
  }

  /** accept transitions recompute the cache and broadcast (D3: accept
   * changes are user-paced; hover changes are the targeted hot path) */
  private setAccept(accept: AcceptState | null): void {
    this.setState({ accept });
    this.recomputeEligible();
    this.registry.notifyAllPres();
  }

  /** an input context is active and this presentation does not match */
  inert(pres: Pick<PresentationRecord, "type" | "ref" | "label">): boolean {
    return this.state.accept != null && !this.eligible(pres);
  }

  /* ------------------------------ accept loop ------------------------------ */

  startCommand(nameOrCmd: string | CommandSpec<W>, seed?: PresentationRecord): void {
    const cmd =
      typeof nameOrCmd === "string" ? this.commands.get(nameOrCmd) : nameOrCmd;
    if (!cmd) {
      this.transcript.err(`Unknown command: ${String(nameOrCmd)}`);
      return;
    }
    this.closeMenu();
    // starting a new command aborts any pending context silently
    if (this.state.accept) this.abort(true);

    const values: ArgValues = {};
    const echoParts: PartLike[] = [B("Command:"), S(" " + cmd.name)];
    const first = cmd.args?.[0];
    if (seed && first && (first.input ?? "presentation") === "presentation") {
      const v = this.coerceFor(first, seed);
      if (v) {
        values[first.name] = v;
        echoParts.push(S(` (${first.name}) `), {
          t: "pres",
          type: v.type,
          ref: v.ref,
          label: v.label,
        });
      }
    }
    this.pendingEchoLineId = this.transcript.echo(...echoParts.map(toPart)).id;
    this.advance(cmd, values);
  }

  /** run with preset values (from the command line's positional args) */
  startCommandWithValues(cmd: CommandSpec<W>, values: ArgValues): void {
    this.closeMenu();
    if (this.state.accept) this.abort(true);
    const parts: PartLike[] = [B("Command:"), S(" " + cmd.name)];
    for (const [name, v] of Object.entries(values))
      parts.push(S(` (${name}) ${v.label}`));
    this.pendingEchoLineId = this.transcript.echo(...parts.map(toPart)).id;
    this.advance(cmd, values);
  }

  private advance(cmd: CommandSpec<W>, values: ArgValues): void {
    const specs = cmd.args ?? [];
    const next = specs.find((s) => !(s.name in values));
    if (!next) {
      this.setAccept(null);
      void this.execute(cmd, values);
      return;
    }
    this.setAccept({ cmd, values, spec: next });
    if ((next.input ?? "presentation") === "menu") this.openChoiceMenu(next, values);
  }

  /** supply the current argument by pointing at a presentation */
  supply(pres: PresentationRecord): void {
    const acc = this.state.accept;
    if (!acc) return;
    const v = this.coerceFor(acc.spec, pres);
    if (!v) return; // ineligible click — coached via the doc line, not errors
    if (acc.spec.where && !acc.spec.where(pres, acc.values, this.world, this.resolveFn)) return;
    this.supplyValue(v);
  }

  /** supply the current argument with an already-built value */
  supplyValue(v: ArgValue): void {
    const acc = this.state.accept;
    if (!acc) return;
    if (acc.spec.distinct) {
      for (const prev of Object.values(acc.values)) {
        if (refEquals(prev.ref, v.ref)) {
          this.transcript.err(`${v.label} was already supplied — pick a distinct ${acc.spec.type.toUpperCase()}.`);
          return;
        }
      }
    }
    if (acc.spec.validate) {
      const r = acc.spec.validate(v, acc.values, this.world, this.resolveFn);
      if (r !== true) {
        this.transcript.err(r);
        return;
      }
    }
    this.transcript.echo(
      S(`  ${acc.spec.name} (a ${acc.spec.type.toUpperCase()}) ⇒ `),
      { t: "pres", type: v.type, ref: v.ref, label: v.label },
    );
    if (acc.resolveAdhoc) {
      this.setAccept(null);
      acc.resolveAdhoc(v);
      return;
    }
    if (acc.cmd) {
      const values = { ...acc.values, [acc.spec.name]: v };
      this.advance(acc.cmd, values);
    }
  }

  abort(silent = false): void {
    const acc = this.state.accept;
    this.closeMenu();
    if (!acc) return;
    this.setAccept(null);
    if (acc.resolveAdhoc) acc.resolveAdhoc(null);
    if (!silent) this.transcript.echo("[Abort]");
  }

  private async execute(cmd: CommandSpec<W>, values: ArgValues): Promise<void> {
    const inv = this.invocations.record(cmd.name, values, this.pendingEchoLineId);
    this.pendingEchoLineId = undefined;
    const undoRef: { undo?: () => void | Promise<void> } = {};
    try {
      await cmd.run(values, this.makeApi(cmd, inv.id, undoRef));
      if (this.invocations.byId(inv.id)?.status === "executing")
        this.invocations.complete(inv.id, undoRef.undo);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.invocations.fail(inv.id, msg);
      this.transcript.err(`Error in ${cmd.name}: ${msg}`);
    }
  }

  private makeApi(
    cmd?: CommandSpec<W>,
    invocationId?: string,
    undoRef?: { undo?: () => void | Promise<void> },
  ): CommandApi<W> {
    return {
      print: (...parts) => this.print(...parts),
      printErr: (...parts) => this.printErr(...parts),
      fail: (...parts) => {
        this.failInvocation(cmd?.name ?? "Command", ...parts);
        if (invocationId)
          this.invocations.fail(
            invocationId,
            parts.map((p) => (typeof p === "string" ? p : "s" in p ? p.s : p.label)).join(""),
          );
      },
      undoable: (capture) => {
        if (undoRef) undoRef.undo = capture();
      },
      snapshotUndo: (store) => {
        if (undoRef) {
          const prev = store.get();
          undoRef.undo = () => store.set(prev as never);
        }
      },
      world: this.world,
      resolve: (v) => this.resolveFn(v.ref),
      accept: (spec) => this.acceptAdhoc(spec),
      invoke: (name, preset) => {
        const cmd = this.commands.get(name);
        if (!cmd) {
          this.transcript.err(`Unknown command: ${name}`);
          return;
        }
        this.advance(cmd, preset ?? {});
      },
    };
  }

  /** promise facade over the FSM (metrics(1)'s prompt(), D6) */
  acceptAdhoc(spec: ArgSpec): Promise<ArgValue | null> {
    if (this.state.accept) this.abort(true);
    return new Promise((resolve) => {
      this.setAccept({ cmd: null, values: {}, spec, resolveAdhoc: resolve });
      if ((spec.input ?? "presentation") === "menu") this.openChoiceMenu(spec, {});
    });
  }

  /* ------------------------------ typed input ------------------------------ */

  /** Enter pressed in the listener input. Routes to the pending argument or
   * to the command line. Returns true if the text was consumed. */
  submitTyped(text: string): boolean {
    const acc = this.state.accept;
    if (acc) {
      const trimmed = text.trim();
      if (!trimmed) {
        const dflt = acc.spec.default?.(acc.values, this.world, this.resolveFn);
        if (dflt) {
          this.supplyValue(dflt);
          return true;
        }
        return false;
      }
      const pt = this.ptypes.get(acc.spec.type);
      if (!pt?.parse) {
        this.transcript.err(`Type a value? ${acc.spec.type.toUpperCase()} arguments are supplied by pointing.`);
        return true;
      }
      const r = pt.parse(trimmed, this.world);
      if (!r.ok) {
        this.transcript.err(r.err);
        return true;
      }
      this.supplyValue({ type: acc.spec.type, ref: r.ref, label: r.label });
      return true;
    }
    return this.submitCommandLine(text);
  }

  /** command line: longest-prefix command match + greedy positional args */
  submitCommandLine(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const words = trimmed.replace(/^:/, "").split(/\s+/);
    for (let k = words.length; k >= 1; k--) {
      const name = words.slice(0, k).join(" ");
      const m = this.commands.match(name);
      if (m.kind === "ambiguous" && k === words.length) {
        this.transcript.err(`"${name}" is ambiguous: ${m.names.join(", ")}`);
        return true;
      }
      if (m.kind === "found") {
        const rest = words.slice(k);
        const values: ArgValues = {};
        const specs = m.cmd.args ?? [];
        for (let i = 0; i < rest.length && i < specs.length; i++) {
          const spec = specs[i]!;
          const pt = this.ptypes.get(spec.type);
          if (!pt?.parse) break;
          const r = pt.parse(rest[i]!, this.world);
          if (!r.ok) {
            this.transcript.err(r.err);
            return true;
          }
          const v: ArgValue = { type: spec.type, ref: r.ref, label: r.label };
          if (spec.distinct) {
            for (const prev of Object.values(values)) {
              if (refEquals(prev.ref, v.ref)) {
                this.transcript.err(`${v.label} was already supplied — pick a distinct ${spec.type.toUpperCase()}.`);
                return true;
              }
            }
          }
          if (spec.validate) {
            const ok = spec.validate(v, values, this.world, this.resolveFn);
            if (ok !== true) {
              this.transcript.err(ok);
              return true;
            }
          }
          values[spec.name] = v;
        }
        this.startCommandWithValues(m.cmd, values);
        return true;
      }
    }
    this.transcript.err(`Unknown command: ${trimmed}`);
    return true;
  }

  completions(text: string): string[] {
    return this.commands.completions(text);
  }

  /* -------------------------------- gestures ------------------------------- */

  notePointer(x: number, y: number): void {
    // no notify: pointer position is read lazily when menus open
    this.state = { ...this.state, pointer: { x, y } };
  }

  gesture(kind: GestureKind, pres: PresentationRecord, x?: number, y?: number): void {
    if (x != null && y != null) this.notePointer(x, y);
    switch (kind) {
      case "enter":
        this.setHover(pres);
        break;
      case "leave":
        if (this.state.hover?.id === pres.id) this.setHover(null);
        break;
      case "click": {
        if (this.state.accept) {
          if (this.eligible(pres)) this.supply(pres);
          // ineligible: swallow (the doc line explains why)
          return;
        }
        this.defaultAction(pres);
        break;
      }
      case "aux":
        this.describePres(pres);
        break;
      case "context": {
        if (this.state.accept) {
          this.abort();
          return;
        }
        this.openCommandMenu(pres, x ?? this.state.pointer.x, y ?? this.state.pointer.y);
        break;
      }
    }
  }

  backgroundContext(x: number, y: number): void {
    if (this.state.accept) {
      this.abort();
      return;
    }
    this.openGlobalMenu(x, y);
  }

  escape(): void {
    if (this.state.menu) {
      this.closeMenu();
      return;
    }
    if (this.state.accept) this.abort();
  }

  /** left-click outside an input context: per-type default command, else Describe */
  defaultAction(pres: PresentationRecord): void {
    const cmd = this.defaultCommandFor(pres);
    if (cmd) {
      this.startCommand(cmd, pres);
      return;
    }
    this.describePres(pres);
  }

  defaultCommandFor(pres: PresentationRecord): CommandSpec<W> | undefined {
    // explicit per-command registration wins, first match (metrics(2):965)
    for (const cmd of this.commands.all()) {
      if (
        cmd.isDefaultFor?.some((t) => this.ptypes.subtypep(pres.type, t)) &&
        this.commandApplies(cmd, pres)
      )
        return cmd;
    }
    const name = this.ptypes.get(pres.type)?.defaultCommand;
    if (name) {
      const cmd = this.commands.get(name);
      if (cmd && this.commandApplies(cmd, pres)) return cmd;
    }
    return undefined;
  }

  /* -------------------------------- describe ------------------------------- */

  describePres(pres: Pick<PresentationRecord, "type" | "ref" | "label">): void {
    const obj = this.resolveFn(pres.ref);
    if (obj === undefined && !("value" in pres.ref)) {
      this.transcript.err(`${pres.label} no longer exists — presentation was stale.`);
      return;
    }
    const value = "value" in pres.ref ? pres.ref.value : obj;
    const pt = this.ptypes.get(pres.type);
    if (pt?.describe) {
      this.transcript.out(...pt.describe(value, this.world).map(toPart));
      return;
    }
    this.transcript.out(this.ptypes.print(pres.type, value, pres.label));
  }

  /* --------------------------------- menus --------------------------------- */

  commandApplies(cmd: CommandSpec<W>, pres: PresentationRecord): boolean {
    if (cmd.hidden || cmd.global) return false;
    if (!takesPresentationFirst(cmd)) return false;
    const first = cmd.args![0]!;
    const v = this.coerceFor(first, pres);
    if (!v) return false;
    if (first.where && !first.where(pres, {}, this.world, this.resolveFn)) return false;
    if (cmd.appliesTo && !cmd.appliesTo(pres, this.world, this.resolveFn)) return false;
    return true;
  }

  applicableCommands(pres: PresentationRecord): CommandSpec<W>[] {
    return this.commands.all().filter((c) => this.commandApplies(c, pres));
  }

  openCommandMenu(pres: PresentationRecord, x: number, y: number): void {
    const cmds = this.applicableCommands(pres);
    const items: MenuItem[] = cmds.map((cmd) => ({
      label: cmd.name + ((cmd.args?.length ?? 0) > 1 ? " …" : ""),
      doc: cmd.doc,
      run: () => this.startCommand(cmd, pres),
    }));
    if (!cmds.some((c) => c.name.toLowerCase().startsWith("describe"))) {
      items.push({ label: "Describe", run: () => this.describePres(pres) });
    }
    this.setState({
      menu: { x, y, title: `${this.ptypes.latticeLabel(pres.type)}  ${pres.label}`, items },
    });
  }

  openGlobalMenu(x: number, y: number): void {
    const items: MenuItem[] = this.commands
      .all()
      .filter((c) => c.global && !c.hidden)
      .map((cmd) => ({
        label: cmd.name + ((cmd.args?.length ?? 0) > 0 ? " …" : ""),
        doc: cmd.doc,
        run: () => this.startCommand(cmd),
      }));
    this.setState({ menu: { x, y, title: "Global Commands", items } });
  }

  private openChoiceMenu(spec: ArgSpec, soFar: ArgValues): void {
    const choices = spec.options?.(soFar, this.world, this.resolveFn) ?? [];
    const { x, y } = this.state.pointer;
    this.setState({
      menu: {
        x,
        y,
        title: spec.prompt ?? `Choose ${spec.name}`,
        items: choices.map((ch) => ({
          label: ch.label,
          run: () => this.supplyValue({ type: spec.type, ref: ch.ref, label: ch.label }),
        })),
      },
    });
  }

  closeMenu(): void {
    if (this.state.menu) this.setState({ menu: null });
  }

  /* ---------------------------------- undo ---------------------------------- */

  /** Undo the most recent undoable invocation. Linear-only (D4): passing an
   * id that is not the last undoable is refused with a coaching message. */
  async undoInvocation(id?: string): Promise<boolean> {
    const last = this.invocations.lastUndoable();
    if (!last) {
      this.transcript.err("Nothing to undo.");
      return false;
    }
    if (id && id !== last.id) {
      const target = this.invocations.byId(id);
      this.transcript.err(
        `Undo is linear — undo ${last.name} first${target ? ` (requested: ${target.name})` : ""}.`,
      );
      return false;
    }
    const undo = last.undo!;
    this.invocations.markUndone(last.id);
    await undo();
    this.transcript.echo(B("Undid:"), S(` ${last.name}`));
    return true;
  }

  /* ----------------------------- prompt / status ---------------------------- */

  promptInfo(): {
    accepting: boolean;
    cmdName?: string;
    filled: { name: string; label: string }[];
    spec?: ArgSpec;
    defaultLabel?: string;
    typedInput: boolean;
  } {
    const acc = this.state.accept;
    if (!acc)
      return { accepting: false, filled: [], typedInput: false };
    const dflt = acc.spec.default?.(acc.values, this.world, this.resolveFn);
    const pt = this.ptypes.get(acc.spec.type);
    return {
      accepting: true,
      cmdName: acc.cmd?.name,
      filled: Object.entries(acc.values).map(([name, v]) => ({ name, label: v.label })),
      spec: acc.spec,
      defaultLabel: dflt?.label,
      typedInput:
        (acc.spec.input ?? "presentation") === "typed" || !!pt?.parse,
    };
  }
}

/* ------------------------------ undo commands ------------------------------ */

/** Register the builtin Undo command, the "invocation" ptype, and the
 * per-invocation Undo command (used by transcript/activity menus). */
export function installUndoCommands<W>(engine: PbuiEngine<W>): void {
  engine.commands.define({
    name: "Undo",
    doc: "Undo the most recent undoable command.",
    global: true,
    run: async () => {
      await engine.undoInvocation();
    },
  });
  if (!engine.ptypes.get("invocation")) {
    engine.ptypes.define<import("./invocation.js").CommandInvocation>({
      name: "invocation",
      print: (inv) => `#<INVOCATION ${inv.name} ${inv.status}>`,
      describe: (inv) => [
        { t: "bold", s: inv.name },
        {
          t: "text",
          s: ` — ${inv.status}${inv.error ? ` (${inv.error})` : ""}${
            inv.undo ? ", undoable" : ""
          }; args: ${Object.values(inv.argValues).map((v) => v.label).join(", ") || "none"}.`,
        },
      ],
    });
  }
  engine.commands.define({
    name: "Undo Invocation",
    doc: "Undo this command (must be the most recent undoable one).",
    hidden: false,
    args: [{ name: "invocation", type: "invocation" }],
    appliesTo: (pres, _world, resolve) => {
      const inv = resolve?.(pres.ref) as import("./invocation.js").CommandInvocation | undefined;
      return !!inv && inv.status === "completed" && !!inv.undo;
    },
    run: async (args) => {
      const ref = args["invocation"]!.ref;
      if ("id" in ref) await engine.undoInvocation(ref.id);
    },
  });
}

# PBUI API Reference

This reference documents every public export of the PBUI monorepo (all packages at version 0.1.0). The system is layered: `@go-go-golems/pbui-core` is a framework-free interaction engine (presentation registry, ptype lattice, command tables, accept loop, transcript, invocation log); `@go-go-golems/pbui-react` binds it to React via context and a headless presentation hook; `@go-go-golems/pbui-listener` and `@go-go-golems/pbui-chrome` are ready-made components over that binding; `@go-go-golems/pbui-theme-genera` is a plain CSS file whose class names and custom properties are the styling contract. Presentations hold `ObjectRef`s, never live objects; refs are resolved through a `Resolver` at gesture and execution time, so stale presentations degrade to an error message instead of acting on dead state.

**Stability.** Two surfaces are pinned by tests and must be treated as frozen contracts: the echo grammar — the text rendering produced by `renderRecord`/`renderTranscript` and the echo lines the engine writes (`Command: <name> (arg) {type label}`, `argname (a TYPE) ⇒ …`, `[Abort]`, `Undid: <name>`) — is golden-tested (`packages/core/src/golden.test.ts`, regenerate only deliberately with `GOLDEN_UPDATE=1`); and the presentation state-class names (`pbui-pres`, `pbui-hover`, `pbui-eligible`, `pbui-inert`, `pbui-passthru`, `pbui-related`, `pbui-kbd-target`) are asserted by the e2e/state-class tests. Renaming either is a breaking change even though it compiles.

## Contents

- [@go-go-golems/pbui-core](#pbuicore)
  - [types](#coretypes) — `ObjectRef`, `valueRef`, `refEquals`, `Resolver`, `Rect`, `PresId`, `PresentationRecord`, `ArgValue`, `ArgValues`, `OutputPart`, `OutputKind`, `OutputRecord`, `PartLike`, `toPart`, `S`, `B`, `E`, `P`, `Unsubscribe`
  - [ptype](#coreptype) — `ParseResult`, `PTypeSpec`, `PType`, `PTypes`, `defineBuiltinPtypes`
  - [registry](#coreregistry) — `RegistryEvent`, `refKey`, `PresentationRegistry`
  - [command](#corecommand) — `Choice`, `ResolveFn`, `ArgSpec`, `CommandApi`, `CommandSpec`, `CommandTable`, `firstArg`, `takesPresentationFirst`
  - [transcript](#coretranscript) — `Transcript`
  - [engine](#coreengine) — `AcceptState`, `MenuItem`, `MenuState`, `EngineState`, `Coercion`, `EngineOptions`, `GestureKind`, `PbuiEngine`, `installUndoCommands`
  - [docline](#coredocline) — `GENERA_IDLE_DOC`, `pointerDoc`, `modeLabel`
  - [transcript-text](#coretranscript-text) — `renderRecord`, `renderTranscript`
  - [builder](#corebuilder) — `arg`, `ArgDesc`, `PresOpts`, `TextOpts`, `NumOpts`, `ChoiceOpts`, `ResolvedArgs`, `BuiltCommand`, `CommandBuilder`, `commandBuilder`
  - [invocation](#coreinvocation) — `InvocationStatus`, `CommandInvocation`, `InvocationLog`
- [@go-go-golems/pbui-react](#pbuireact) — `PbuiProvider`, `useEngine`, `useEngineState`, `useTranscript`, `usePbuiSurface`, `usePresentation`, `Presentation`, `SvgPresentation`
- [@go-go-golems/pbui-listener](#pbuilistener) — `Listener`, `PartView`
- [@go-go-golems/pbui-chrome](#pbuichrome) — `ContextMenuHost`, `MouseDocBar`, `StatusLine`, `Pane`, `ActivityPane`
- [@go-go-golems/pbui-theme-genera](#pbuitheme-genera) — CSS custom properties and classes

---

# @go-go-golems/pbui-core

`packages/core/src/index.ts` re-exports every module below in full.

## core/types

### ObjectRef

```ts
type ObjectRef =
  | { kind: string; id: string }
  | { kind: "value"; value: unknown };
```

A reference to a domain object: `kind` names the object family and `id` its key. Immediate values (numbers, strings, enum choices) use the `{ kind: "value", value }` form and are self-contained — they never go through a `Resolver`.

### valueRef

```ts
function valueRef(value: unknown): ObjectRef
```

Wraps an immediate value as `{ kind: "value", value }`.

### refEquals

```ts
function refEquals(a: ObjectRef, b: ObjectRef): boolean
```

Returns true when both refs are value refs with `===`-equal values, or both are entity refs with equal `kind` and `id`. A value ref never equals an entity ref.

### Resolver

```ts
interface Resolver {
  resolve(ref: ObjectRef): unknown | undefined;
}
```

Application-supplied mapping from refs to live domain objects. Returning `undefined` means the object no longer exists; the engine and builder translate that into stale-presentation errors rather than passing `undefined` to command bodies.

### Rect

```ts
interface Rect { x: number; y: number; w: number; h: number }
```

Screen bounds in pixels. Also re-exported from `registry.ts`.

### PresId

```ts
type PresId = string;
```

Registry-assigned presentation id (`"p1"`, `"p2"`, …).

### PresentationRecord

```ts
interface PresentationRecord {
  id: PresId;
  type: string;                 // ptype name
  ref: ObjectRef;
  label: string;                // used in echoes, menus, doc line
  paneId?: string;
  parentId?: PresId;
  mode?: "gated" | "active" | "fallthrough";
  bounds?: () => Rect | null;   // null/undefined = not hit-testable
}
```

The record stored in the `PresentationRegistry` — the presentation database. `mode` sets participation while a foreign input context is pending:

| mode | behavior during a foreign accept |
|---|---|
| `"gated"` (default) | dimmed (`pbui-inert`) and clicks are swallowed |
| `"active"` | stays interactive; left-click may run a `duringAccept` command without aborting the context; right-click opens a reduced menu of `duringAccept` commands |
| `"fallthrough"` | gesture-transparent (`pbui-passthru`); events reach whatever is beneath |

### ArgValue, ArgValues

```ts
interface ArgValue { type: string; ref: ObjectRef; label: string }
type ArgValues = Record<string, ArgValue>;
```

The shape in which the accept loop stores collected arguments, whether they came from a click, the keyboard, or a menu. `ArgValues` is keyed by argument name.

### OutputPart, OutputKind, OutputRecord

```ts
type OutputPart =
  | { t: "text"; s: string }
  | { t: "bold"; s: string }
  | { t: "err";  s: string }
  | { t: "pres"; type: string; ref: ObjectRef; label: string };

type OutputKind = "out" | "echo" | "err";

interface OutputRecord { id: string; kind: OutputKind; parts: OutputPart[] }
```

| variant | meaning | text rendering (`renderRecord`) | listener rendering (`PartView`) |
|---|---|---|---|
| `text` | plain text | `s` | `<span>` |
| `bold` | emphasized text | `**s**` | `<b>` |
| `err` | error text | `s` | `<span class="pbui-line-errpart">` |
| `pres` | live presentation embedded in output | `{type label}` | a mounted `<Presentation>` — stays mouse-sensitive |

`OutputRecord.id` is globally monotonic (`"l1"`, `"l2"`, …).

### PartLike, toPart

```ts
type PartLike = OutputPart | string;
function toPart(p: PartLike): OutputPart
```

Print helpers accept `PartLike`; `toPart` converts a string to `{ t: "text", s }` and passes parts through unchanged.

### S, B, E, P

```ts
const S: (s: string) => OutputPart                                   // text
const B: (s: string) => OutputPart                                   // bold
const E: (s: string) => OutputPart                                   // err
const P: (type: string, ref: ObjectRef, label: string) => OutputPart // pres
```

Part constructors.

### Unsubscribe

```ts
type Unsubscribe = () => void;
```

Returned by every `subscribe` method; calling it removes the listener.

## core/ptype

### ParseResult

```ts
type ParseResult<T = unknown> =
  | { ok: true; value: T; ref: ObjectRef; label: string }
  | { ok: false; err: string };
```

Result of a ptype's keyboard parser. On success it carries the parsed value plus the ref/label the accept loop stores; on failure `err` is printed verbatim to the transcript.

### PTypeSpec, PType

```ts
interface PTypeSpec<T = unknown, W = unknown> {
  name: string;
  supertypes?: string[];                       // omitted = child of "any"
  print?: (obj: T) => string;                  // e.g. `#<TASK T-3>`
  parse?: (text: string, world: W) => ParseResult<T>;
  describe?: (obj: T, world: W) => PartLike[];
  defaultCommand?: string;                     // left-click default outside an accept
}

interface PType<T, W> extends PTypeSpec<T, W> { supertypes: string[] }
```

A presentation type: a node in the named lattice with optional codecs. `print` and `parse` are the two halves of the round-trip codec; `describe` produces the rich Describe output and falls back to the printed representation when omitted.

### PTypes

```ts
class PTypes<W = unknown> {
  define<T>(spec: PTypeSpec<T, W>): PType<T, W>;
  get(name: string): PType<unknown, W> | undefined;
  subtypep(t: string, want: string): boolean;
  latticePath(t: string): string[];
  latticeLabel(t: string): string;
  print(type: string, obj: unknown, label?: string): string;
}
```

The ptype registry. `define` throws at define time for the reserved name `"any"`, for any supertype that is neither `"any"` nor already defined (`unknown supertype "X" of "Y"`), and for self-reference; because supertypes must pre-exist, cycles are impossible by construction. `subtypep(t, want)` is true when `want` is `"any"`, when `t === want`, or when `want` is reachable through the supertype graph (BFS over all supertypes, not just the first). `latticePath("milestone")` returns the first-parent chain ending in `"any"` (e.g. `["milestone", "task", "any"]`); `latticeLabel` upper-cases it and joins with `" ⊂ "` — the context-menu title convention. `print` calls the type's printer only when `obj !== undefined` (printers never receive `undefined`), catches printer exceptions, and in all fallback cases returns the generic form `#<TYPE label>` (label omitted when not given).

### defineBuiltinPtypes

```ts
function defineBuiltinPtypes<W>(ptypes: PTypes<W>): void
```

Registers the `"number"` and `"string"` argument ptypes used by typed input. `number` parses via `Number(text.trim())` and rejects empty or `NaN` input with `<text> is not a valid NUMBER`; `string` trims and rejects empty input with `empty STRING`. Both produce value refs.

## core/registry

### RegistryEvent

```ts
type RegistryEvent =
  | { kind: "register";   rec: PresentationRecord }
  | { kind: "update";     rec: PresentationRecord }
  | { kind: "unregister"; id: PresId };
```

### refKey

```ts
function refKey(r: ObjectRef): string
```

Canonical string key for a ref: `v:<String(value)>` for value refs, `<kind>:<id>` for entity refs. Distinct values whose string forms collide map to the same key.

### PresentationRegistry

```ts
class PresentationRegistry {
  register(rec: Omit<PresentationRecord, "id">): PresId;
  update(id: PresId, patch: Partial<Omit<PresentationRecord, "id">>): void;
  unregister(id: PresId): void;
  get(id: PresId): PresentationRecord | undefined;
  all(): PresentationRecord[];
  byRef(ref: ObjectRef): PresentationRecord[];
  byType(type: string): PresentationRecord[];
  at(x: number, y: number): PresentationRecord | undefined;
  subscribe(fn: (ev: RegistryEvent) => void): Unsubscribe;
  notifyPres(id: PresId): void;
  notifyAllPres(): void;
  subscribePres(id: PresId, fn: () => void): Unsubscribe;
  presVersion(id: PresId): number;
}
```

The subscribable store of every presentation currently on screen or in the transcript. `register` assigns the id and emits a `register` event; `update` and `unregister` are no-ops for unknown ids. `byRef` is O(presentations-of-that-object) via a `refKey` index; `byType` filters `all()`. `at(x, y)` returns the smallest hit-testable presentation (by bounds area) containing the point, or `undefined`. Two notification channels exist: `subscribe` receives every registry event, while `subscribePres`/`notifyPres`/`presVersion` form a per-presentation invalidation channel — `notifyPres` bumps that presentation's version counter and wakes only its subscribers (the hover-paced hot path), and `notifyAllPres` does so for every registered presentation (accept transitions). `unregister` also drops the presentation's listeners and version.

## core/command

### Choice

```ts
interface Choice { label: string; ref: ObjectRef }
```

One entry of a menu-valued argument.

### ResolveFn

```ts
type ResolveFn = (ref: ObjectRef) => unknown | undefined;
```

Engine-supplied ref resolution passed as the optional last parameter to every spec callback, so layered authoring APIs (the typed builder) can hand user code live objects. The engine's implementation resolves `kind: "invocation"` refs from its own invocation log and delegates everything else to the app `Resolver`.

### ArgSpec

```ts
interface ArgSpec {
  name: string;
  type: string;                                  // ptype name
  input?: "presentation" | "typed" | "menu";     // default "presentation"
  prompt?: string;
  options?: (soFar: ArgValues, world: unknown, resolve?: ResolveFn) => Choice[];
  default?: (soFar: ArgValues, world: unknown, resolve?: ResolveFn) => ArgValue | undefined;
  distinct?: boolean;
  where?: (pres: PresentationRecord, soFar: ArgValues, world: unknown, resolve?: ResolveFn) => boolean;
  validate?: (v: ArgValue, soFar: ArgValues, world: unknown, resolve?: ResolveFn) => true | string;
}
```

One argument declaration. Everywhere the engine tests `input`, an omitted value means `"presentation"`; ptypes with a `parse` function additionally accept typed input regardless of `input`. `options` supplies the choices for `input: "menu"` arguments and may depend on already-collected values. `default` is offered as `[default …]` in the prompt and taken when Enter is pressed on empty input. `distinct: true` rejects a value whose ref `refEquals` any previously collected argument of the same command. `where` filters candidate presentations (eligibility and clicks); `validate` checks a supplied value and rejects by returning an error string, which is printed as an error line.

### CommandApi

```ts
interface CommandApi<W> {
  print:    (...parts: PartLike[]) => void;
  printErr: (...parts: PartLike[]) => void;
  fail:     (...parts: PartLike[]) => void;
  undoable: (capture: () => () => void | Promise<void>) => void;
  snapshotUndo: <S>(store: { get(): S; set(state: S): void }) => void;
  world: W;
  resolve: (v: ArgValue) => unknown | undefined;
  accept:  (spec: ArgSpec) => Promise<ArgValue | null>;
  invoke:  (name: string, preset?: ArgValues) => void;
}
```

The capability facade injected into command bodies; bodies never touch UI state directly. `print`/`printErr` append `out`/`err` transcript records. `fail` prints `<reason> <Command> aborted.` as an error line and marks the current invocation `failed` — it does not throw, so the body must `return` after calling it. `undoable(capture)` runs `capture` immediately and stores the returned function as this invocation's undo; `snapshotUndo(store)` reads `store.get()` at call time and installs an undo that restores that whole snapshot via `store.set` — call it before mutating the store, since it captures state as of the call, and note that undo replaces the entire store state, including changes made by later non-undoable code. `resolve` maps a collected `ArgValue` to the live object (`undefined` = stale). `accept` is the mid-body accept: it suspends the body until the user supplies a matching value or aborts, resolving to the `ArgValue` or `null` on abort. `invoke` chains to another command; preset values skip their prompts, and if all arguments are preset the command executes immediately (without its own `Command:` echo line).

### CommandSpec

```ts
interface CommandSpec<W = unknown> {
  name: string;
  doc?: string;
  args?: ArgSpec[];
  appliesTo?: (pres: PresentationRecord, world: W, resolve?: ResolveFn) => boolean;
  isDefaultFor?: string[];
  global?: boolean;
  hidden?: boolean;
  duringAccept?: boolean;
  run: (args: ArgValues, api: CommandApi<W>) => void | Promise<void>;
}
```

A command as data: menus, prompting, the mouse-doc line, and the command line all derive from the declaration. `appliesTo` adds applicability beyond first-argument type matching. `isDefaultFor` lists ptypes for which this command is the left-click default; the first matching command in definition order wins, ahead of the ptype's own `defaultCommand`. `global: true` makes the command reachable only from the background menu and the command line (never from presentation menus); `hidden: true` removes it from all menus (command line only). `duringAccept: true` allows the command to run from an `"active"` presentation while an input context is pending, without aborting it; such a command must be seed-complete (see `CommandTable.define`).

### CommandTable

```ts
class CommandTable<W = unknown> {
  define(spec: CommandSpec<W>): CommandSpec<W>;
  defineAll(specs: CommandSpec<W>[]): void;
  get(name: string): CommandSpec<W> | undefined;
  all(): CommandSpec<W>[];
  match(text: string):
    | { kind: "found"; cmd: CommandSpec<W> }
    | { kind: "ambiguous"; names: string[] }
    | { kind: "none" };
  completions(text: string): string[];
}
```

`define` throws at define time on a duplicate name (`duplicate command "X"`), and refuses a `duringAccept` command that is not seed-complete — it must have either no arguments or exactly one argument whose `input` is (or defaults to) `"presentation"`, so a single invoking presentation can supply everything. `match` strips a leading `:`, lower-cases, and tries exact name match first, then unique prefix; multiple prefix hits report `ambiguous` with the candidate names. `completions` returns all command names with the given (case-insensitive, `:`-stripped) prefix.

### firstArg, takesPresentationFirst

```ts
function firstArg<W>(cmd: CommandSpec<W>): ArgSpec | undefined
function takesPresentationFirst<W>(cmd: CommandSpec<W>): boolean
```

`firstArg` returns `cmd.args?.[0]`. `takesPresentationFirst` is true when the first argument exists and its `input` is (or defaults to) `"presentation"` — i.e. the command can be started by pointing.

## core/transcript

### Transcript

```ts
class Transcript {
  constructor(cap?: number);                          // default 300
  print(kind: OutputKind, ...parts: PartLike[]): OutputRecord;
  out(...parts: PartLike[]): OutputRecord;
  echo(...parts: PartLike[]): OutputRecord;
  err(...parts: PartLike[]): OutputRecord;
  clear(): void;
  lines(): OutputRecord[];
  subscribe(fn: () => void): Unsubscribe;
}
```

A capped, subscribable list of output records whose `pres` parts remain live presentations. `print` converts strings via `toPart`, appends a record, drops the oldest records past the cap (default 300), notifies subscribers, and returns the new record. `out`/`echo`/`err` are `print` with the kind fixed. `lines()` returns a stable array snapshot suitable for `useSyncExternalStore`; the array identity changes only when records change.

## core/engine

### AcceptState

```ts
interface AcceptState {
  cmd: CommandSpec<any> | null;    // null for an ad-hoc api.accept()
  values: ArgValues;               // arguments collected so far
  spec: ArgSpec;                   // the argument currently wanted
  resolveAdhoc?: (v: ArgValue | null) => void;
}
```

### MenuItem, MenuState

```ts
interface MenuItem { label: string; doc?: string; disabled?: boolean; run: () => void }
interface MenuState { x: number; y: number; title: string; items: MenuItem[] }
```

### EngineState

```ts
interface EngineState {
  accept: AcceptState | null;
  hover: PresentationRecord | null;
  menu: MenuState | null;
  pointer: { x: number; y: number };
  focus: string | null;            // keyboard focus cursor (PresId)
}
```

### Coercion

```ts
interface Coercion {
  from: string;
  to: string;
  coerce: (pres: PresentationRecord) => ArgValue;
}
```

A registered coercion makes presentations of subtype-of-`from` supply arguments of supertype-of-`to`. Coercions are tried in registration order after the direct subtype test fails; the first match wins.

### EngineOptions

```ts
interface EngineOptions<W> {
  ptypes: PTypes<W>;
  commands: CommandTable<W>;
  world: W;
  resolver: Resolver;
  transcriptCap?: number;   // default 300
  idleDoc?: string;         // default "Mouse-L: default action; Mouse-M: Describe; Mouse-R: menu of commands."
}
```

### GestureKind

```ts
type GestureKind = "click" | "aux" | "context" | "enter" | "leave";
```

### PbuiEngine

```ts
class PbuiEngine<W = unknown> {
  constructor(opts: EngineOptions<W>);
  readonly ptypes: PTypes<W>;
  readonly commands: CommandTable<W>;
  readonly registry: PresentationRegistry;
  readonly transcript: Transcript;
  readonly invocations: InvocationLog;
  readonly world: W;
  readonly resolver: Resolver;
  readonly resolveFn: ResolveFn;
  readonly idleDoc: string;
}
```

The framework-free interaction engine: it owns the accept-loop state machine, gesture routing, menu derivation, coercions, describe, the echo grammar, and the typed-input/command-line paths; renderers subscribe and render, nothing here touches the DOM. `resolveFn` is the bound `ResolveFn` handed to spec callbacks — it resolves `kind: "invocation"` refs from the engine's own invocation log and delegates all other refs to `opts.resolver`. The constructor subscribes to its registry so that presentations registered or updated mid-accept join or leave the eligible-set cache incrementally, with no full recompute on the hot path.

#### Subscription and printing

```ts
getState(): EngineState
subscribe(fn: () => void): Unsubscribe
print(...parts: PartLike[]): void
printErr(...parts: PartLike[]): void
failInvocation(cmdName: string, ...reason: PartLike[]): void
```

`getState` returns the current immutable state snapshot; `subscribe` fires on every state change. Hover transitions additionally notify (via `registry.notifyPres`) exactly the old and new hover targets plus every presentation of the same objects — the related-hover set. `print`/`printErr` append `out`/`err` records. `failInvocation` prints `<reason> <cmdName> aborted.` as an error line; unlike `CommandApi.fail`, calling it directly does not touch the invocation log.

#### Coercions and eligibility

```ts
defineCoercion(c: Coercion): void
eligible(pres: Pick<PresentationRecord, "type" | "ref" | "label"> & { id?: string }): boolean
eligibleList(): PresentationRecord[]
inert(pres: Pick<PresentationRecord, "type" | "ref" | "label">): boolean
```

`eligible` answers "would clicking this presentation supply the currently wanted argument?" — false when no accept is active. It is O(1) for registered presentations via the eligible-set cache (keyed by `id`); unregistered records fall back to the full predicate (subtype-or-coercion match, then `where`, then `distinct` against already-collected values). The cache is rebuilt on every accept transition and updated incrementally on registry events. `eligibleList` returns the registered presentations currently eligible (used for keyboard Tab-cycling); it is empty when no accept is active. `inert` is true when an input context is active and the presentation is not eligible.

#### The accept loop

```ts
startCommand(nameOrCmd: string | CommandSpec<W>, seed?: PresentationRecord): void
startCommandWithValues(cmd: CommandSpec<W>, values: ArgValues): void
supply(pres: PresentationRecord): void
supplyValue(v: ArgValue): void
abort(silent?: boolean): void            // default false
acceptAdhoc(spec: ArgSpec): Promise<ArgValue | null>
```

`startCommand` looks up the command by name if given a string (printing `Unknown command:` on a miss), closes any menu, silently aborts any pending input context, echoes `Command: <name>` (with the seed argument appended as a live `pres` part when a seed presentation coerces to a presentation-input first argument), and begins prompting for the first unfilled argument. When every argument is filled the command executes; when the wanted argument has `input: "menu"` its choice menu opens at the last pointer position. `startCommandWithValues` is the command-line entry: preset values are echoed as plain text, not `pres` parts. `supply` coerces a clicked presentation for the pending argument, applying `where`; an ineligible click is silently ignored (the doc line coaches instead of erroring). `supplyValue` enforces `distinct` (error: `<label> was already supplied — pick a distinct TYPE.`) and `validate`, echoes `  <arg> (a TYPE) ⇒ {type label}`, then either resolves a pending ad-hoc accept or advances the command. `abort` cancels the pending context and echoes `[Abort]` unless `silent` is true; ad-hoc accepts resolve to `null`. `acceptAdhoc` is the promise facade over the FSM used by `CommandApi.accept`; starting it silently aborts any prior context. Command execution records an invocation (status `executing`), awaits `run`, then marks it `completed` (attaching any captured undo) — unless the body already failed it via `api.fail` — or `failed` when `run` throws, printing `Error in <name>: <message>`.

#### Typed input and the command line

```ts
submitTyped(text: string): boolean
submitCommandLine(text: string): boolean
completions(text: string): string[]
```

`submitTyped` is the listener's Enter handler; it returns true when the text was consumed. During an accept: empty input takes the argument's `default` if one exists (otherwise returns false, leaving the draft); non-empty input parses via the wanted ptype's `parse` — a ptype without `parse` yields `Type a value? TYPE arguments are supplied by pointing.`, and parse failures print the parser's error. Outside an accept it delegates to `submitCommandLine`, which strips a leading `:`, splits on whitespace, and finds the longest word-prefix that matches a command name (ambiguity is reported only when the whole input is the ambiguous name). Remaining words bind greedily to leading arguments whose ptypes have `parse`, applying `distinct` and `validate` per value; binding stops at the first argument without a parser, and any words past the bindable arguments are silently ignored. The matched command then starts with those preset values. Unknown input prints `Unknown command: <text>`. `completions` delegates to `commands.completions`.

#### Gestures and menus

```ts
notePointer(x: number, y: number): void
gesture(kind: GestureKind, pres: PresentationRecord, x?: number, y?: number): void
backgroundContext(x: number, y: number): void
escape(): void
defaultAction(pres: PresentationRecord): void
defaultCommandFor(pres: PresentationRecord): CommandSpec<W> | undefined
commandApplies(cmd: CommandSpec<W>, pres: PresentationRecord): boolean
applicableCommands(pres: PresentationRecord): CommandSpec<W>[]
openCommandMenu(pres: PresentationRecord, x: number, y: number): void
openGlobalMenu(x: number, y: number): void
closeMenu(): void
```

`notePointer` records the pointer position without notifying subscribers (it is read lazily when menus open). `gesture` routes by kind and current context:

| gesture | no input context | input context pending |
|---|---|---|
| `enter` | set hover | set hover |
| `leave` | clear hover if this presentation is hovered | same |
| `click` | run the default action | eligible → `supply`; `mode: "active"` → run the default command if it is `duringAccept`; otherwise swallowed |
| `aux` (middle) | Describe | Describe |
| `context` (right) | command menu for the presentation | `mode: "active"` → reduced menu of `duringAccept` commands; otherwise abort the context |

A `duringAccept` command run from an active presentation executes immediately with the presentation as its seed, leaves the pending input context untouched, and recomputes eligibility afterwards in case its effects changed `where`-clauses. `backgroundContext` aborts a pending context, otherwise opens the global menu. `escape` closes an open menu first, else aborts the pending context. `defaultAction` (left-click outside a context) starts the presentation's default command, falling back to Describe. `defaultCommandFor` checks `isDefaultFor` registrations in command-definition order first (subtype-aware, filtered by applicability), then the ptype's `defaultCommand`. `commandApplies` requires: not `hidden`, not `global`, a presentation-input first argument, a successful coercion, the first argument's `where` (called with empty `soFar`), and `appliesTo`. `openCommandMenu` lists applicable commands (labels get a trailing `" …"` when the command has more than one argument), appending a built-in Describe item when no applicable command name starts with "describe"; its title is `latticeLabel(type)` plus the label. `openGlobalMenu` lists `global` non-`hidden` commands (`" …"` when they take any arguments) under the title `Global Commands`.

#### Describe

```ts
describePres(pres: Pick<PresentationRecord, "type" | "ref" | "label">): void
```

Resolves the ref; a stale entity ref prints `<label> no longer exists — presentation was stale.` Otherwise the ptype's `describe` output is printed, falling back to `ptypes.print`.

#### Keyboard focus

```ts
setFocus(id: string | null): void
focusTarget(): string | null
focusRecord(): PresentationRecord | null
moveFocus(dir: 1 | -1): string | null
moveFocusEligible(dir: 1 | -1): string | null
```

The keyboard focus cursor over presentations. `setFocus` notifies only the old and new targets. `focusTarget` returns the id that should carry `tabIndex={0}`: the focus cursor if it still exists, else the first registered presentation. `moveFocus` cycles through registry order (arrow keys); `moveFocusEligible` cycles the eligible set (Tab during an accept); both wrap around and return the new focus id, or `null` when there is nothing to focus.

#### Undo

```ts
undoInvocation(id?: string): Promise<boolean>
```

Undoes the most recent undoable invocation (status `completed` with an `undo`). Undo is linear-only: with no undoable invocation it prints `Nothing to undo.`; passing an `id` that is not the last undoable is refused with `Undo is linear — undo <last> first (requested: <target>).` On success the invocation is marked `undone`, the captured undo runs, `Undid: <name>` is echoed, and the method resolves true.

#### Prompt state

```ts
promptInfo(): {
  accepting: boolean;
  cmdName?: string;
  filled: { name: string; label: string }[];
  spec?: ArgSpec;
  defaultLabel?: string;
  typedInput: boolean;
}
```

Pull-style derivation for prompt renderers. `typedInput` is true when the wanted argument's `input` is `"typed"` or its ptype has a `parse` function; `defaultLabel` is the label of the argument's current `default`, if any.

### installUndoCommands

```ts
function installUndoCommands<W>(engine: PbuiEngine<W>): void
```

Registers three things on the engine: the global `Undo` command (undoes the most recent undoable invocation); the `invocation` ptype (printer `#<INVOCATION <name> <status>>` and a describe listing status, error, undoability, and argument labels), skipped if a ptype of that name already exists; and the `Undo Invocation` command, which takes one `invocation` argument, applies only to invocations that are `completed` and undoable, and defers to `undoInvocation(id)` — so it is refused unless the invocation is the most recent undoable one. Calling `installUndoCommands` twice throws (duplicate command).

## core/docline

### GENERA_IDLE_DOC

```ts
const GENERA_IDLE_DOC: string
// "To see other commands, press Shift, Control, Meta-Shift, or Super."
```

The classic Genera idle line, offered as an alternative `idleDoc`. Note the engine's built-in default is different (`"Mouse-L: default action; Mouse-M: Describe; Mouse-R: menu of commands."`).

### pointerDoc

```ts
function pointerDoc(engine: PbuiEngine<any>): string
```

Pure derivation of the mouse-doc line from engine state (pull, never push). The keyboard focus cursor documents itself exactly like hover. Priority: an open menu → `Choose an item — Mouse-L selects; [Escape] dismisses.`; a pending accept → per-hover coaching (eligible target, active target with a `duringAccept` default, inapplicable target, or the general "Accepting a TYPE" line, adding "or type it at the prompt" when the ptype has `parse`); a hovered presentation → `<printed> — L: <default>; M: Describe; R: menu of N commands.`; otherwise `engine.idleDoc`.

### modeLabel

```ts
function modeLabel(engine: PbuiEngine<any>): string
```

Status-line mode: `"Menu Choose"` when a menu is open, `"Accept TYPE"` during an accept, else `"User Input"`.

## core/transcript-text

### renderRecord

```ts
function renderRecord(rec: OutputRecord): string
```

Canonical text rendering of one record: `[<kind padded to 4>] <body>`, where `text` and `err` parts render as their string, `bold` as `**s**`, and `pres` as `{type label}`. This format is the golden-tested echo grammar; refactors must not move a character of it.

### renderTranscript

```ts
function renderTranscript(records: OutputRecord[]): string
```

Renders each record on its own line and appends a trailing newline.

## core/builder

The typed command builder compiles typed argument descriptors into the `CommandSpec`/`ArgSpec` runtime and wraps `run` with resolve-then-run: entity refs are resolved through the engine's resolver, value refs are unwrapped, and any stale entity aborts the command centrally with the standardized message (`<label> no longer exists — presentation was stale; <Command> aborted.`) — command bodies never see an `ObjectRef`.

### arg

```ts
const arg: {
  presentation<T>(ptype: string, opts?: PresOpts<T, any, any>): ArgDesc<T>;
  text(opts?: TextOpts<any, any>): ArgDesc<string>;
  number(opts?: NumOpts<any, any>): ArgDesc<number>;
  choice<T extends string>(opts: ChoiceOpts<T, any, any>): ArgDesc<T>;
};
```

Argument descriptor constructors. `presentation` is an object supplied by pointing (or via the ptype's `parse`); `text` compiles to a `"string"`-ptype argument with `input: "typed"`; `number` likewise with ptype `"number"` plus range/integer sugar; `choice` compiles to a `"string"`-ptype argument with `input: "menu"` whose options become value-ref `Choice`s.

### ArgDesc

```ts
interface ArgDesc<T = unknown> {
  readonly ptype: string;
  readonly kind: "presentation" | "text" | "number" | "choice";
  readonly opts: Record<string, unknown>;
  readonly __t?: T;    // phantom carrier for the resolved value type
}
```

### PresOpts, TextOpts, NumOpts, ChoiceOpts

```ts
interface PresOpts<T, A, W> {
  prompt?: string;
  distinct?: boolean;
  allowStale?: boolean;   // body receives T | undefined instead of aborting
  where?: (candidate: T, soFar: Partial<ResolvedArgs<A>>, world: W) => boolean;
  validate?: (value: T, soFar: Partial<ResolvedArgs<A>>, world: W) => true | string;
}

interface TextOpts<A, W> {
  prompt?: string;
  default?: string | ((soFar: Partial<ResolvedArgs<A>>, world: W) => string);
  validate?: (value: string, soFar: Partial<ResolvedArgs<A>>, world: W) => true | string;
}

interface NumOpts<A, W> {
  prompt?: string;
  default?: number | ((soFar: Partial<ResolvedArgs<A>>, world: W) => number);
  min?: number;
  max?: number;
  integer?: boolean;
  validate?: (value: number, soFar: Partial<ResolvedArgs<A>>, world: W) => true | string;
}

interface ChoiceOpts<T extends string, A, W> {
  prompt?: string;
  options: (soFar: Partial<ResolvedArgs<A>>, world: W) => { label: string; value: T }[];
}
```

Builder-level callbacks receive resolved values (`soFar` is the already-collected arguments, resolved; stale entries are omitted), not `ArgValue`s. Compiled `where` rejects presentations whose objects are stale; compiled `validate` rejects stale values with `<label> no longer exists`. For `number`, the sugar validates in order: `integer` (`<name> must be an integer`), `min` (`<name> must be at least <min>`), `max` (`<name> must be at most <max>`), then the user `validate`. `default` values are stringified for the label and stored as value refs; number descriptors coerce resolved immediates with `Number()`.

### ResolvedArgs

```ts
type ResolvedArgs<A> = { [K in keyof A]: A[K] extends ArgDesc<infer T> ? T : never };
```

Maps a descriptor record to the value types the body receives.

### BuiltCommand

```ts
interface BuiltCommand<A extends Record<string, ArgDesc<any>>, W> {
  name: string;
  doc?: string;
  args?: A;                        // key insertion order = accept order; key = display name
  appliesTo?: (first: ResolvedArgs<A>[keyof A], world: W) => boolean;
  isDefaultFor?: string[];
  global?: boolean;
  hidden?: boolean;
  duringAccept?: boolean;          // seed-complete rule applies at define time
  run: (args: ResolvedArgs<A>, api: CommandApi<W>) => void | Promise<void>;
}
```

The typed command shape. The `args` object's key insertion order is the accept order, and each key is the argument's display name. `appliesTo` receives the first argument already resolved (a stale first object makes the command inapplicable).

### CommandBuilder, commandBuilder

```ts
class CommandBuilder<W> {
  constructor(table: CommandTable<W>);
  define<A extends Record<string, ArgDesc<any>>>(built: BuiltCommand<A, W>): CommandSpec<W>;
  defineAll<A extends Record<string, ArgDesc<any>>>(builts: BuiltCommand<A, W>[]): void;
}

function commandBuilder<W>(table: CommandTable<W>): CommandBuilder<W>
```

`define` compiles the descriptors, wraps `run` with resolve-then-run (a stale non-`allowStale` entity calls `api.fail` with the standardized stale message and skips the body), registers the resulting `CommandSpec` in the table, and returns it; the table's define-time errors (duplicate name, seed-complete rule) apply unchanged. `commandBuilder` is the constructor as a function.

## core/invocation

### InvocationStatus

```ts
type InvocationStatus = "executing" | "completed" | "failed" | "undone";
```

### CommandInvocation

```ts
interface CommandInvocation {
  id: string;              // "inv-17"
  name: string;
  argValues: ArgValues;    // args as collected — refs, so records survive world GC
  status: InvocationStatus;
  error?: string;
  undo?: () => void | Promise<void>;   // present iff the command opted in and completed
  seq: number;             // monotonic ordering
  echoLineId?: string;     // transcript echo line this invocation belongs to
}
```

Every executed command becomes a first-class, presentable record. Core is clock-free: `seq` orders records; applications map to wall time at display if they want it.

### InvocationLog

```ts
class InvocationLog {
  constructor(cap?: number);   // default 100
  record(name: string, argValues: ArgValues, echoLineId?: string): CommandInvocation;
  complete(id: string, undo?: () => void | Promise<void>): void;
  fail(id: string, error: string): void;
  markUndone(id: string): void;
  byId(id: string): CommandInvocation | undefined;
  byEchoLine(lineId: string): CommandInvocation | undefined;
  lastUndoable(): CommandInvocation | undefined;
  list(): CommandInvocation[];
  subscribe(fn: () => void): Unsubscribe;
}
```

`record` appends a new invocation with status `executing` and drops the oldest records past the cap (default 100) — an undoable invocation that falls off the log can no longer be undone. `complete` sets status `completed` and attaches the undo; `fail` sets `failed` with the error; `markUndone` sets `undone` and clears the undo. `lastUndoable` scans from the newest and returns the only invocation `PbuiEngine.undoInvocation` will touch (linear undo). `list` returns the stable snapshot array; every mutation notifies subscribers.

---

# @go-go-golems/pbui-react

### PbuiProvider

```ts
function PbuiProvider(props: { engine: PbuiEngine<any>; children: ReactNode }): JSX.Element
```

Puts the engine in React context and installs a window-level `keydown` handler that maps Escape to `engine.escape()` (dismiss menu, else abort the pending context). Mount exactly one per engine.

### useEngine

```ts
function useEngine<W = unknown>(): PbuiEngine<W>
```

Returns the context engine; throws `useEngine: no <PbuiProvider> above` when there is none. This hook does not subscribe — reads are not reactive.

### useEngineState

```ts
function useEngineState(): EngineState
```

Subscribes to the engine's interaction state (hover / accept / menu / focus) via `useSyncExternalStore` and returns the current snapshot. Pointer moves recorded with `notePointer` do not notify, so they do not re-render subscribers.

### useTranscript

```ts
function useTranscript(): OutputRecord[]
```

Subscribes to the engine's transcript and returns the current lines snapshot.

### usePbuiSurface

```ts
function usePbuiSurface(): {
  onMouseMove: () => void;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}
```

Root-surface handlers to spread onto the app's outermost element: mouse moves that reach the background clear hover (presentations stop propagation of their own moves), clicks dismiss any open menu, and right-clicks call `preventDefault` and open the background context (`engine.backgroundContext`, which aborts a pending input context instead when one is active).

### usePresentation

```ts
function usePresentation(input: UsePresentationInput): PresentationHandle

interface UsePresentationInput {
  type: string;
  ref: ObjectRef;
  label: string;
  pane?: string;
  quiet?: boolean;      // container: menuable, but no hover/related/focus outline, never dims inert
  duringAccept?: "gated" | "active" | "fallthrough";   // default "gated"
  disabled?: boolean;   // render-only: no registration, no gestures
}

interface PresentationHandle {
  props: {
    ref: (el: Element | null) => void;
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseLeave: () => void;
    onClick: (e: React.MouseEvent) => void;
    onAuxClick: (e: React.MouseEvent) => void;
    onContextMenu: (e: React.MouseEvent) => void;
    onFocus: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    tabIndex: number;
    "data-pbui-type": string;
  };
  isFocused: boolean;
  isHovered: boolean;
  isEligible: boolean;
  isInert: boolean;
  isRelatedHover: boolean;   // some presentation of the same object is hovered elsewhere
  className: string;
}
```

The headless presentation hook. It registers a `PresentationRecord` for the lifetime of the component (with `bounds` measured lazily from the attached element) and returns spreadable gesture-protocol props plus derived state flags. Subscription is targeted: the component listens to its own presentation id only (`registry.subscribePres`), so a hover transition re-renders exactly the presentations whose flags changed; accept transitions broadcast via `notifyAllPres`. Re-registration occurs when `type`, the ref key, `label`, `pane`, `duringAccept`, or `disabled` changes. When the engine's focus cursor lands on this presentation, real DOM focus follows so the browser's accessibility tree tracks it; `tabIndex` is 0 only for the roving `focusTarget` (or the focused element), −1 otherwise. `className` is the space-joined state classes: always `pbui-pres`, plus `pbui-hover`, `pbui-kbd-target`, and `pbui-related` (all suppressed by `quiet`), `pbui-eligible`, `pbui-inert` (gated mode only, suppressed by `quiet`), and `pbui-passthru` (fallthrough mode during a foreign accept). Every render increments the global counter `window.__pbuiRenders`, which the performance-budget spec reads. Keyboard bindings in `onKeyDown`:

| key | action |
|---|---|
| Enter, Space | click gesture at the element's center |
| `m`, ContextMenu, Shift+F10 | context gesture at the element's center |
| `d` | aux gesture (Describe) |
| Tab / Shift+Tab (during an accept) | cycle the eligible presentations forward / backward |
| ArrowRight, ArrowDown | move the focus cursor forward through registry order |
| ArrowLeft, ArrowUp | move the focus cursor backward |

### Presentation

```ts
function Presentation(props: PresentationProps): JSX.Element

interface PresentationProps {
  type: string;
  object: ObjectRef;        // named `object`, not `ref` (React ref conflict)
  label: string;
  pane?: string;
  quiet?: boolean;
  duringAccept?: "gated" | "active" | "fallthrough";
  disabled?: boolean;
  block?: boolean;          // render a <div> instead of a <span>
  className?: string;       // appended after the state classes
  style?: CSSProperties;
  title?: string;
  children?: ReactNode;
}
```

Sugar over `usePresentation` that renders a `<span>` (or `<div>` with `block`) carrying the gesture props and state classes. The `ref` prop is typed `never` to prevent confusion with React refs; pass the object as `object`.

### SvgPresentation

```ts
function SvgPresentation(props: SvgPresentationProps): JSX.Element

interface SvgPresentationProps extends Omit<PresentationProps, "block"> {
  hitRect?: { x: number; y: number; width: number; height: number };
}
```

The SVG rendering of the same protocol: a `<g>` carrying the gesture props and state classes. When `hitRect` is given, an invisible `<rect fill="transparent">` behind the children makes the area hit-testable, a `pbui-svg-hover-ring` rect (hit rect inflated by 2px) renders while hovered and not `quiet`, and a `pbui-svg-eligible-ring` rect (inflated by 3px) renders while eligible. Without `hitRect` no rings render.

---

# @go-go-golems/pbui-listener

### Listener

```ts
function Listener(props: {
  prompt?: string;              // idle prompt label; default "> "
  className?: string;
  style?: React.CSSProperties;
}): JSX.Element
```

The scrolling transcript plus a prompt line that morphs between the idle command line, typed-argument input, and a "point at a highlighted TYPE" banner. Requires `PbuiProvider`. Transcript lines whose id matches an invocation's `echoLineId` are wrapped in a quiet, block `invocation` presentation (`object: { kind: "invocation", id }`), so past commands are right-clickable for Undo Invocation / Describe — `installUndoCommands` supplies both the ptype and the command. Behavior: the pane auto-scrolls to the newest line; a visually hidden `aria-live="polite"` region announces only the newest line; clicking the scrollback focuses the input; the input pulls focus whenever a typed argument is wanted. Keys: Enter submits via `engine.submitTyped` (the draft is kept when not consumed; consumed non-blank lines enter a 50-entry history ring); ArrowUp/ArrowDown walk the history, with Down past the newest restoring the unsent draft; Tab (idle only) completes a unique command name in place or prints `Completions: …` for multiple matches. During an accept the prompt label shows the command name, filled arguments as `(name: label)`, the wanted argument as `(name: a TYPE [default …]) ⇒ `, and — when the argument cannot be typed — the hint `(point at a highlighted TYPE)`.

### PartView

```ts
function PartView(props: { part: OutputPart }): JSX.Element
```

Renders one output part: `text` as `<span>`, `bold` as `<b>`, `err` as `<span class="pbui-line-errpart">`, and `pres` as a mounted `<Presentation pane="listener">` whose children are the label — so objects mentioned in the transcript stay mouse-sensitive for as long as they are on screen.

---

# @go-go-golems/pbui-chrome

### ContextMenuHost

```ts
function ContextMenuHost(): JSX.Element | null
```

Renders the engine's `menu` state as a viewport-clamped popup (`pbui-menu`); returns null when no menu is open. It serves both command menus and choice menus for menu-valued arguments, and is a real ARIA menu: focus moves into the popup on open and returns to the invoking element on close; ArrowUp/ArrowDown wrap, Home/End jump, Enter/Space activate, printable keys type-ahead over item labels (the prefix buffer resets after 800 ms of quiet; a repeated single letter advances past the current item). Activating an item closes the menu, then runs it; disabled items do not activate. An empty menu shows `(no applicable commands)`. Below a separator, a permanent italic **Abort** footer participates in keyboard navigation as the last item; activating it closes the menu and aborts any pending input context.

### MouseDocBar

```ts
function MouseDocBar(props: { right?: string }): JSX.Element
```

The inverse-video mouse-doc bar: renders `pointerDoc(engine)` in a `role="status"` `aria-live="polite"` bar, with the optional `right` string on the trailing edge. Re-renders on every engine state change.

### StatusLine

```ts
function StatusLine(props: { user?: string; pkg?: string; host?: string }): JSX.Element
```

The Genera status line: `[<Day D Mon HH:MM:SS>] <user> <pkg>: <mode>` with `host` pushed to the trailing edge. Defaults: `user` = `"user"`, `pkg` = `"PBUI"`. The clock ticks every second; the mode is `modeLabel(engine)`.

### Pane

```ts
function Pane(props: {
  title: string;
  subtitle?: string;
  extra?: ReactNode;      // trailing header actions
  className?: string;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
  children?: ReactNode;
}): JSX.Element
```

Bordered pane frame with an uppercase bold title, optional italic subtitle, optional trailing header content, and a scrollable body. Purely presentational; no engine dependency.

### ActivityPane

```ts
function ActivityPane(props: { title?: string; limit?: number }): JSX.Element
```

The invocation log rendered inside a `Pane` (default title `"Activity"`) as a list of live `invocation` presentations, newest first, capped at `limit` (default 20). Each row shows a status glyph (`…` executing, `✓` completed, `✕` failed, `↩` undone), the command name as a right-clickable presentation, argument labels, an `(undone)` marker, and any error. Requires `installUndoCommands(engine)` for the `invocation` ptype and the Undo Invocation menu entry.

---

# @go-go-golems/pbui-theme-genera

`packages/theme-genera/src/genera.css` — the shared monochrome Genera/Dynamic-Windows look. Import it once; apply `pbui-root` to the app's outermost element. Chrome stays monochrome; the accent color tokens are intended for text only. These class names and custom properties are the theming API: components reference the classes, applications override the properties.

## CSS custom properties (on `:root`)

| property | default | role |
|---|---|---|
| `--pbui-ink` | `#000` | foreground / borders / inverse-video background |
| `--pbui-paper` | `#fff` | background |
| `--pbui-desk` | `#d9d9d9` | desktop backdrop (for apps; unused inside this sheet) |
| `--pbui-teal` | `#00655f` | text accent (for apps; unused inside this sheet) |
| `--pbui-coral` | `#a03623` | text accent (for apps; unused inside this sheet) |
| `--pbui-gold` | `#7a5d00` | text accent (for apps; unused inside this sheet) |
| `--pbui-font` | `"Lucida Console", "IBM Plex Mono", Menlo, Consolas, monospace` | monospace stack |
| `--pbui-font-size` | `12px` | base size |

## Presentation state classes (pinned contract)

Applied by `usePresentation` / `Presentation` / `SvgPresentation`; asserted by the state-class tests.

| class | when | styling |
|---|---|---|
| `pbui-pres` | every presentation | transparent 2px outline reserved (no layout shift on hover); default cursor |
| `pbui-hover` | pointer is over this presentation (not `quiet`) | solid ink outline |
| `pbui-related` | another presentation of the same object is hovered (not `quiet`) | dotted ink outline |
| `pbui-kbd-target` | keyboard focus cursor is here (not `quiet`) | 3px double ink outline |
| `pbui-eligible` | would supply the pending argument | dashed ink outline with the `pbui-ants` marching animation (disabled under `prefers-reduced-motion: reduce`) |
| `pbui-inert` | gated during a foreign accept (not `quiet`) | `opacity: 0.3; pointer-events: none` |
| `pbui-passthru` | fallthrough during a foreign accept | `pointer-events: none` only (visually normal) |
| `pbui-svg-hover-ring` | `SvgPresentation` hover ring | ink stroke, width 2 |
| `pbui-svg-eligible-ring` | `SvgPresentation` eligible ring | ink stroke, dashed `4 3` |

## Component classes

| group | classes |
|---|---|
| root | `pbui-root` (paper background, ink text, monospace, `user-select: none`; also styles descendant WebKit scrollbars) |
| menu (`ContextMenuHost`) | `pbui-menu` (fixed, `z-index: 1000`, 200–320px wide, 2px ink border), `pbui-menu-title` (inverse video), `pbui-menu-item`, `pbui-menu-focus` (inverse video, shared with `:hover`), `pbui-menu-disabled` (`opacity: .45`), `pbui-menu-sep`, `pbui-menu-abort` (italic) |
| doc bar (`MouseDocBar`) | `pbui-docbar` (inverse video), `pbui-docbar-text` (bold, ellipsized), `pbui-docbar-right` |
| status (`StatusLine`) | `pbui-status`, `pbui-status-mode` (bold), `pbui-status-host` (pushed right) |
| pane (`Pane`) | `pbui-pane` (2px ink border, column flex), `pbui-pane-title`, `pbui-pane-title-text` (bold uppercase, letter-spaced), `pbui-pane-subtitle` (italic), `pbui-pane-extra` (pushed right), `pbui-pane-body` (scrollable) |
| listener (`Listener`) | `pbui-listener`, `pbui-listener-scroll` (scrollable; `user-select: text` so transcript text is copyable despite the root's `user-select: none`), `pbui-line` (`white-space: pre-wrap`), `pbui-line-out`, `pbui-line-echo` (bold), `pbui-line-err` (italic, with a bold `>>Error: ` prefix via `::before`), `pbui-line-errpart` (italic), `pbui-prompt-line`, `pbui-prompt-label` (bold, `white-space: pre`), `pbui-prompt-input` (borderless, inherits font), `pbui-prompt-hint` (italic) |

`pbui-line-out` is generated by the listener (`pbui-line-<kind>`) but carries no rules in this sheet.

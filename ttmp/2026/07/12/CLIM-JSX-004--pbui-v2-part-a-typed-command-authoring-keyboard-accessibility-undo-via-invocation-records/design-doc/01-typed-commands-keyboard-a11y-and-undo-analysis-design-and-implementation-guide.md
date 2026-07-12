---
Title: 'Typed commands, keyboard/a11y, and undo: analysis, design, and implementation guide'
Ticket: CLIM-JSX-004
Status: active
Topics:
    - pbui
    - react
    - typescript
    - design
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://packages/core/src/command.ts
      Note: Current ArgSpec/CommandSpec — the untyped callbacks this design replaces
    - Path: repo://packages/core/src/engine.ts
      Note: Accept-loop engine that the builder compiles onto and that grows invocation records
    - Path: repo://apps/demos/src/demos/ecommerce/engine.ts
      Note: The largest command table; primary evidence for authoring pain
    - Path: repo://packages/chrome/src/menu.tsx
      Note: Menu component gaining roles and keyboard operation
    - Path: repo://packages/listener/src/listener.tsx
      Note: Listener gaining input history and live-region wiring
ExternalSources: []
Summary: "Design for @pbui v2 part A: a typed command builder with automatic argument resolution and centralized stale handling; a real keyboard and accessibility layer (roving focus, keyboard accepts, ARIA menus, live doc line, listener history); and undo built on command invocation records."
LastUpdated: 2026-07-12T19:01:01.098541568-04:00
WhatFor: "Implementation guide for the CLIM-JSX-004 workstream."
WhenToUse: "Read before implementing the typed builder, the a11y layer, or undo."
---

# Typed commands, keyboard/a11y, and undo — analysis, design, and implementation guide

*Audience: a new intern. You do not need to have read anything else first;
Section 2 orients you. When it says `file.ts:NN` it means a real line in
this repository — go read it.*

## 1. Executive summary

The @pbui packages (built under ticket CLIM-JSX-001) implement a
presentation-based UI engine: typed on-screen objects, command tables, and
an accept loop that collects typed arguments by pointing or typing. Six
demo apps run on it. Writing them exposed three costs this ticket removes:

1. **Command authoring is noisy and weakly typed.** Every command body
   re-implements the same ref-resolution and staleness dance (57 hand-
   written "stale" checks across the demos), digs primitive values out of
   `ObjectRef` unions by hand, and casts `world: unknown` back to its real
   type in every `where`/`validate`/`options` callback. We fix this with a
   **typed argument-descriptor builder** that compiles to the existing
   runtime shape: `run` receives *resolved, typed* values; staleness is
   handled once, centrally.
2. **The paradigm is mouse-only.** No keyboard navigation between
   presentations, no keyboard path through an accept, menus without ARIA
   roles or arrow keys, a doc line screen readers never hear, and a
   listener without input history. We add a **keyboard/a11y layer**:
   roving focus across presentations, Tab-cycling of eligible
   presentations during accepts, ARIA-correct menus, live-region doc line,
   and Up/Down history in the listener.
3. **There is no undo.** Commands mutate the world and the only record is
   prose in the transcript. We introduce **command invocation records** —
   first-class, presentable objects with lifecycle state (exactly the
   thesis's "command application", aitr-794 §5.1) — and an undo protocol
   with two opt-in flavors: store-snapshot undo (one line for our demos)
   and explicit inverse functions.

Everything is additive: the existing `CommandSpec` runtime keeps working;
the builder, a11y layer, and invocations layer on top. Phased plan in
Section 9; the e-commerce demo is the migration proving ground.

## 2. System orientation (read this if you're new)

@pbui is a pnpm monorepo. The pieces you need for this ticket:

- **`packages/core/`** — framework-free. `engine.ts` (595 lines) is the
  heart: it owns the *accept loop* (a command needing arguments puts the
  UI into an "accepting" state; matching presentations light up; clicking
  one, or typing at the listener prompt, supplies the argument —
  `engine.ts:177-282`), gesture routing (`engine.ts:414-451`), menus, and
  the transcript. `command.ts` defines the data shapes: `ArgSpec` (a typed
  argument slot) and `CommandSpec` (name + args + `run`).
- **`packages/react/`** — `usePresentation` registers an on-screen object
  in the engine's registry and returns mouse handlers + state flags
  (`use-presentation.ts`).
- **`packages/listener/`** — the transcript + prompt component.
- **`packages/chrome/`** — context menu, mouse-doc bar, status line.
- **`apps/demos/`** — six apps. The e-commerce back office
  (`apps/demos/src/demos/ecommerce/`) has the largest command table
  (22 commands; its `engine.ts` is 566 lines) and is the best place to
  see the pain this ticket removes.

Two core vocabulary items used throughout:

- An **`ObjectRef`** is how presentations refer to domain objects without
  holding them: `{kind: "order", id: "o-3"}` for entities, or
  `{kind: "value", value: 42}` for immediates
  (`packages/core/src/types.ts`). A **Resolver** turns refs back into live
  objects; `undefined` means the object is gone ("stale").
- An **`ArgValue`** is a collected argument: `{type, ref, label}`
  (`types.ts`). Command `run` bodies currently receive a record of these —
  refs, not objects.

The full architecture rationale lives in the CLIM-JSX-001 design doc
(`ttmp/2026/07/12/CLIM-JSX-001--*/design-doc/01-*.md`); you don't need it
to implement this ticket, but read its Section 3 if the CLIM background
interests you.

## 3. Current-state analysis (evidence)

### 3.1 Command authoring: the four recurring taxes

Open `apps/demos/src/demos/ecommerce/engine.ts` and look at what every
command pays:

1. **The resolution/staleness dance.** Every body starts with some form of

   ```ts
   const o = resolveOrder(args["order"]!);
   if (!o) return api.printErr("Stale order presentation.");
   ```

   `rg -c "presentation was stale|Stale" apps/demos/src/demos` counts 57
   such lines across seven apps. The engine cannot resolve for the
   command because `run` receives raw `ArgValues`
   (`packages/core/src/command.ts:48-58`); it hands out a resolver instead
   (`api.resolve`, `command.ts:41`).

2. **Value unwrapping.** Primitives arrive as
   `{kind: "value", value: unknown}` refs, so bodies write
   `("value" in v.ref ? v.ref.value : undefined)` or define local helpers
   (`val`/`refId` at `apps/demos/src/demos/ecommerce/engine.ts:43-44`;
   near-copies exist in five other demos). The `unknown` then needs a
   cast: `Number(val(args["qty"]!))`.

3. **`world: unknown` in callbacks.** `ArgSpec.where / validate / options /
   default` all take `world: unknown`
   (`packages/core/src/command.ts:25-33`) because `ArgSpec` is not generic
   over the world type. Every app-level predicate casts: four
   `(w as World)` casts in the e-commerce ptypes alone
   (`apps/demos/src/demos/ecommerce/engine.ts:56,66,75,90`), more in the
   `where` clauses.

4. **Non-null assertions.** `args["order"]!` everywhere — the record type
   `ArgValues = Record<string, ArgValue>` cannot know which keys exist,
   even though the command's own `args` array right above it says so.

None of these are bugs; all of them are the type system not being told
what the command already declares. That is exactly what a builder fixes.

### 3.2 Keyboard and accessibility: what exists and what doesn't

What exists today:

- Global Escape (abort/dismiss) — `packages/react/src/provider.tsx:20-27`.
- A listener `<input>` with Enter/Tab handling
  (`packages/listener/src/listener.tsx:34-46`) and one `aria-label`
  (`listener.tsx:79`) — the only ARIA attribute in the whole codebase
  (verified by grep).
- Tab *completion* in the listener; but pressing Tab elsewhere does
  nothing useful, because presentations are unfocusable `<span>`s/`<g>`s.

What does not exist:

- **Focus:** no `tabIndex` anywhere in `use-presentation.ts`; keyboard
  users cannot reach a presentation at all, so they can neither invoke its
  default command, open its menu, nor supply it to an accept.
- **Menus:** `packages/chrome/src/menu.tsx` renders plain `<div>`s — no
  `role="menu"`/`menuitem`, no arrow keys, no focus trap, no return-focus.
  Choice menus (menu-valued arguments) share the gaps.
- **Announcements:** the mouse-doc bar re-renders silently; screen readers
  never hear "Accepting a SITE…". The transcript likewise.
- **Gestures:** middle-click = Describe is hardcoded
  (`use-presentation.ts:115-119`); trackpads are awkward and touch has no
  story at all.
- **Selection:** `user-select: none` on the root theme class
  (`packages/theme-genera/src/genera.css:24`) makes transcript text
  uncopyable.
- **History:** no Up/Down recall in the listener input — Genera's
  listener had it; its absence is the first thing you notice when using
  the command line.

### 3.3 Undo: nothing, but the landing pad exists

Commands mutate the world directly (`cmd.run` called at
`packages/core/src/engine.ts:283-289`) and the engine keeps no record
beyond transcript prose. The CLIM-JSX-001 design doc explicitly reserved
"CommandInvocation objects with lifecycle state" as the undo landing pad
(its §6.5 and open question 1), mirroring the thesis's *command
application* objects — invocations with pending/executing/completed state
that are themselves presentable (aitr-794.md:1537-1545). The e-commerce
demo makes the absence concrete: `Refund Order` exists partly because
there is no undo for `Fulfill Order`.

One structural asset makes undo cheap here: every demo world is an
immutably-updated `Store<T>` (`apps/demos/src/lib/store.ts`) — state is
replaced, never mutated in place — so *snapshot undo* is literally
"remember the previous state object", with structural sharing keeping it
cheap.

## 4. Gap analysis

| # | Gap | Evidence | Fixed by |
|---|-----|----------|----------|
| G1 | run receives refs, not objects; staleness handled 57× by hand | §3.1(1) | Typed builder + central resolution (§5) |
| G2 | Primitive args need manual unwrap + cast | §3.1(2) | `arg.number()/arg.text()` descriptors (§5.2) |
| G3 | `world: unknown` in ArgSpec callbacks | command.ts:25-33 | Generic flow via builder (§5.3) |
| G4 | `args["x"]!` non-null asserts | §3.1(4) | Mapped result types (§5.2) |
| G5 | Presentations unfocusable; no keyboard gesture path | §3.2 | Roving focus + key map (§6.1-6.2) |
| G6 | Menus are not ARIA menus; mouse-only | menu.tsx | Menu rewrite (§6.3) |
| G7 | Doc line / transcript silent for assistive tech | §3.2 | Live regions (§6.4) |
| G8 | Middle-click hardcoded; no touch story | use-presentation.ts:115 | Gesture map option (§6.5) |
| G9 | No listener input history; transcript unselectable | §3.2 | History + `user-select` fix (§6.6) |
| G10 | No invocation records, no undo | §3.3 | Invocations + undo protocol (§7) |

## 5. Design A: the typed command builder

### 5.1 Shape of the solution

One new module, `packages/core/src/builder.ts`, exporting an `arg`
namespace of **argument descriptors** and a builder that compiles
descriptors into today's `CommandSpec` (`command.ts`) — the engine runtime
is untouched except for one small hook (§5.4). A command written with the
builder:

```ts
const commands = new CommandTable<World>();
const c = commandBuilder(commands, ptypes);   // binds World once

c.define({
  name: "Refund Order",
  doc: "Refund and restock.",
  args: {
    order:  arg.presentation<Order>("order"),
    reason: arg.text({ prompt: "the refund reason" }),
  },
  appliesTo: (order, w) => order.status === "paid" || order.status === "fulfilled",
  run: ({ order, reason }, api) => {
    // order: Order   (already resolved — never stale here)
    // reason: string (already unwrapped)
    // api.world: World (no cast)
    ...
  },
});
```

Contrast with today's version
(`apps/demos/src/demos/ecommerce/engine.ts:243-262`): the body loses the
resolve call, the stale guard, the `val()` unwrap, and the `orderIs`
helper's `"id" in pres.ref` plumbing.

### 5.2 Argument descriptors and result typing

```ts
// builder.ts (sketch)
export interface ArgDesc<T> {
  readonly ptype: string;
  readonly spec: Omit<ArgSpec, "name">;   // compiled ArgSpec fields
  readonly __t?: T;                       // phantom type carrier
}

export const arg = {
  /** an object supplied by pointing (or via the ptype's parse) */
  presentation<T>(ptype: string, opts?: PresOpts): ArgDesc<T>;
  /** typed text -> string */
  text(opts?: TextOpts): ArgDesc<string>;
  /** typed text -> number, with min/max/integer sugar */
  number(opts?: NumOpts): ArgDesc<number>;
  /** menu choice over a closed set */
  choice<T extends string>(opts: {
    options: (soFar: unknown, world: unknown) => { label: string; value: T }[];
    prompt?: string;
  }): ArgDesc<T>;
};

type Resolved<A> = { [K in keyof A]: A[K] extends ArgDesc<infer T> ? T : never };

export interface BuiltCommand<A, W> {
  name: string;
  doc?: string;
  args?: A;                        // object; insertion order = accept order
  appliesTo?: (first: FirstResolved<A>, world: W) => boolean;
  isDefaultFor?: string[];
  global?: boolean;
  run: (args: Resolved<A>, api: TypedApi<W>) => void | Promise<void> | UndoHandle;
}
```

Key decisions embedded here:

- **Args are an object, not an array.** JS preserves string-key insertion
  order, so `Object.entries(args)` yields the accept order and the key
  doubles as the display name. This is what lets `Resolved<A>` exist as a
  mapped type — `run`'s first parameter is fully inferred.
- **`appliesTo` receives the resolved first-arg object,** not a raw
  `PresentationRecord` — the builder wraps today's predicate
  (`command.ts:52`) with resolution, eliminating the `orderIs` helper
  pattern (`apps/demos/src/demos/ecommerce/engine.ts:52-53`, which
  re-implements ref-checking the engine already knows how to do).
- **Per-descriptor callbacks get typed `soFar`.** `where`, `validate`,
  `default`, `options` receive `Partial<Resolved<A>>` and `W` — resolved
  objects. The gallery's Untag `where` (the `soFar["image"]` / `"id" in`
  plumbing in `apps/demos/src/demos/gallery/GalleryDemo.tsx`) becomes
  `(tag, { image }) => image?.tags.includes(tag.name) ?? false`.

### 5.3 Compilation to the existing runtime

`c.define(built)` produces and registers a plain `CommandSpec<W>`:

```
built.args (object of ArgDesc)                compiled ArgSpec[]
  { order: arg.presentation<Order>("order"),    [{ name:"order", type:"order", ...},
    reason: arg.text(...) }             --->    { name:"reason", type:"string",
                                                  input:"typed", ...}]

built.run(resolved, typedApi)                 spec.run(argValues, api)
                                       <---   wrapper:
                                              1. for each ArgValue: entity refs
                                                 -> resolver.resolve; value refs
                                                 -> unwrap
                                              2. any entity undefined?
                                                 -> engine.failInvocation(...)
                                                 with the standardized stale
                                                 message; DO NOT call run
                                              3. call built.run with the
                                                 resolved record
```

The wrapper is ~40 lines. Descriptor callbacks are compiled the same way:
wrap, resolve `soFar` once per call, delegate. `ArgSpec`'s
`world: unknown` fields stay exactly as they are — `W` lives in the
*builder*, so core's runtime types need no breaking change.

### 5.4 The one engine hook

The stale-abort in step 2 must echo consistently and record the failure.
Add one engine method:

```ts
// engine.ts
failInvocation(cmdName: string, reason: PartLike[]): void
// prints the >>Error line and records an invocation with status "failed" (§7)
```

Everything else about the builder is a pure layer over
`CommandTable.define` (`command.ts:70-78`).

### 5.5 Migration

v1 `CommandSpec` stays public and supported — the six demos keep working
untouched. Migrate `apps/demos/src/demos/ecommerce/engine.ts` first (most
to gain); measure the diff (expected: −150 lines, zero casts, zero `!`
asserts in bodies). Then the gallery. The Genera ports can stay on v1
indefinitely; they are period artifacts.

## 6. Design B: keyboard and accessibility layer

### 6.1 Focusable presentations with a roving cursor

`usePresentation` grows keyboard support (provider option, on by default):

- Rather than one tab stop per presentation (a 200-presentation screen
  would need 200 Tabs), use a **roving pattern per pane**: one tab stop
  per `paneId`; Arrow keys move a *focus cursor* among that pane's
  presentations in registry order; DOM `focus()` follows the cursor.
- Focus becomes engine state: `state.focus: PresId | null` next to
  `hover` (`engine.ts:88-93`). The doc-line derivations
  (`docline.ts:10-33`) treat a focused presentation exactly like a
  hovered one — the documentation line doubles as the screen reader's
  context.

Key map on a focused presentation (mirroring the mouse protocol at
`engine.ts:414-451`):

| Key | Gesture equivalent |
|---|---|
| Enter / Space | left click (supply if eligible, else default command) |
| ContextMenu key / Shift+F10 / `m` | right click (command menu) |
| `d` | middle click (Describe) |
| Arrows | move focus cursor within the pane |
| Escape | unchanged (global abort/dismiss) |

### 6.2 A keyboard path through every accept

When an accept is active, Tab gets a better job than completion:
**Tab / Shift+Tab cycle the eligible presentations**. The engine already
knows them — expose `eligibleList(): PresentationRecord[]` built from
`registry.byType` + `eligible()` (`engine.ts:155-173`) — and move focus
with a distinct `pbui-kbd-target` outline; Enter supplies the focused
one. The prompt keeps working for typed supply. Together with §6.1 this
makes every flow in every demo completable without a mouse. (CLIM-JSX-005
plans an eligible-set cache; `eligibleList` should ride on it — coordinate
but don't block.)

### 6.3 Menus

Rewrite `packages/chrome/src/menu.tsx` (70 lines today) to:

- `role="menu"` / `role="menuitem"` / `aria-disabled`, labelled by the
  title bar.
- Focus moves into the menu on open and **returns to the invoking
  element** on close (capture `document.activeElement` at open).
- ArrowUp/Down with wrap, Home/End, Enter/Space activates; **type-ahead**
  (printable keys jump to the next matching item).
- The same component already serves choice menus for menu-valued
  arguments (`engine.ts:316`), so keyboard users gain those for free.

### 6.4 Announcements

- Mouse-doc bar (`packages/chrome/src/mouse-doc.tsx`): `role="status"` +
  `aria-live="polite"`. It already re-renders only when its derived text
  changes; additionally debounce hover-driven changes ~150ms so sweeping
  the mouse doesn't chatter.
- Transcript: a visually-hidden `aria-live="polite"` mirror of the *last*
  output record only (announcing scrollback is noise).
- Accept transitions are announced for free — "Accepting a SITE…" is
  already the derived doc-line text.

### 6.5 Gesture configurability

```ts
new PbuiEngine({ ..., gestures: {
  describe: ["aux", "keyD"],                 // defaults shown
  menu:     ["context", "keyM", "longpress"],
}})
```

`usePresentation` consults the map instead of hardcoding `onAuxClick`
(`use-presentation.ts:115-119`). Touch defaults: long-press → menu,
double-tap → describe; both overridable.

### 6.6 Listener quality

- **Input history**: Up/Down recall in `listener.tsx` — ring buffer of
  submitted lines (per listener, cap 50); Down past the newest restores
  the unsent draft. Pure component change.
- **Selectable transcript**: `user-select: text` on
  `.pbui-listener-scroll`, overriding the global `none`
  (`genera.css:24`); chrome and presentations stay non-selectable.

## 7. Design C: invocation records and undo

### 7.1 The record

```ts
// core/src/invocation.ts
export interface CommandInvocation {
  id: string;                        // "inv-17"
  name: string;                      // "Fulfill Order"
  argValues: ArgValues;              // as collected (refs — survive world GC)
  status: "executing" | "completed" | "failed" | "undone";
  error?: string;
  /** present iff the command opted into undo and completed */
  undo?: () => void | Promise<void>;
  seq: number;                       // monotonic; apps map to wall time
}

export class InvocationLog {           // capped (default 100), subscribable
  record(partial): CommandInvocation;
  complete(id, undo?): void;
  fail(id, error): void;
  markUndone(id): void;
  lastUndoable(): CommandInvocation | undefined;
  list(): CommandInvocation[];
  subscribe(fn): Unsubscribe;
}
```

`PbuiEngine.execute` (`engine.ts:283-289`) brackets `cmd.run` with
`record` / `complete` / `fail`. Core stays clock-free (no `Date.now()`);
`seq` orders records, apps stamp wall time if they want it (D5).

### 7.2 The undo protocol — two flavors

**Flavor 1: snapshot undo** (one line, for Store-based worlds). The typed
api gains:

```ts
api.undoable(capture: () => () => void): void
// sugar for immutable stores:
api.snapshotUndo(store)   // = api.undoable(() => { const prev = store.get();
                          //     return () => store.set(prev); })
```

Because demo worlds are immutably updated (`apps/demos/src/lib/store.ts`),
`prev` shares structure with the successor state — cheap to hold, exact to
restore. Opting a command in is a single first line.

**Flavor 2: explicit inverse.** `run` returns an `UndoHandle`
(`{ undo: () => void }`) for commands whose inverse is not "restore the
world" — anything with external effects. The builder's `run` return type
already allows it (§5.2).

**What must NOT get an undo:** commands whose effects leave the world
(Email Customer) and pure navigation (Switch To View, Show Order) —
register nothing; the log still records them as non-undoable history.
Guidance, not enforcement.

### 7.3 Undo as a command; invocations as presentations

- Core provides `installUndoCommands(table)`: **Undo** pops
  `lastUndoable()`, runs its `undo`, marks it `undone`, echoes
  `Undid: Fulfill Order #1012` with live parts. Redo is explicitly out of
  scope v1 (D4).
- New ptype `"invocation"` with a default describer (name, status, args
  as live parts). Each command's echo line gains an invocation part, so
  **right-clicking a past command in the transcript offers Undo** when
  applicable — history made of presentations, the CLIM move.
- `@pbui/chrome` gains an optional `<ActivityPane>`: the invocation log
  as invocation presentations with status glyphs. The e-commerce demo
  mounts it on the Dashboard tab as its audit log.

### 7.4 Interaction with staleness and ticks

Snapshot undo restores the whole store — no staleness problem, but it
also reverts *unrelated concurrent mutations* (e.g. a simulation tick
between run and undo). Acceptable in demos; the doc and PORTING-NOTES
must flag it, and real apps with live ticks should prefer explicit
inverses. Undo is **linear-only** in v1: undoing anything but the most
recent undoable invocation is refused ("Undo is linear — undo #inv-19
first"), which sidesteps the selective-undo dependency swamp.

## 8. Decision records

### Decision D1: Builder compiles to the existing runtime; no core rewrite

- **Context:** Fixing G1–G4 could mean breaking `CommandSpec`/engine
  signatures (and all six demos), or layering.
- **Options considered:** (a) make `CommandSpec` generic and resolved
  end-to-end (breaking); (b) a compile-to-v1 builder; (c) codegen.
- **Decision:** (b).
- **Rationale:** The runtime shape is fine — the *authoring* types are the
  problem. A ~200-line builder gets full typing with zero migration
  pressure; mapped types do the work at compile time only.
- **Consequences:** Two documented authoring styles until demos migrate;
  the builder must stay behaviorally identical to hand-written specs —
  enforced by the equivalence tests in §10.1.
- **Status:** proposed

### Decision D2: Resolve-then-run with central stale abort

- **Context:** Where should staleness be handled?
- **Options considered:** (a) status quo (per-body); (b) resolve all args
  before `run`, abort on any stale entity; (c) lazy proxies that throw on
  access.
- **Decision:** (b).
- **Rationale:** 57 hand-written guards prove (a) doesn't scale; (c) hides
  control flow inside property access. (b) is what every body already
  does in its first lines — we just move it.
- **Consequences:** Commands that want stale objects (none exist today)
  use `arg.presentation<T>(ptype, { allowStale: true })` and receive
  `T | undefined`.
- **Status:** proposed

### Decision D3: Roving focus per pane, not a tab stop per presentation

- **Context:** Hundreds of presentations would make Tab useless.
- **Options considered:** (a) tabindex=0 everywhere; (b) roving cursor per
  pane, Tab between panes; (c) focus only during accepts.
- **Decision:** (b), with (c)'s accept-cycling layered on top (§6.2).
- **Rationale:** Matches WAI-ARIA composite-widget practice; Tab count =
  pane count; arrows navigate within.
- **Consequences:** Registry needs stable per-pane ordering (registration
  order suffices today); SVG `<g tabindex>` focus must be verified in the
  scheduler port.
- **Status:** proposed

### Decision D4: Linear undo only, snapshot-first, no redo in v1

- **Context:** Undo scope inflates easily.
- **Options considered:** (a) full command pattern with redo + selective
  undo; (b) linear undo with snapshot + explicit-inverse opt-ins;
  (c) world-diff journaling.
- **Decision:** (b).
- **Rationale:** Immutable stores make snapshots nearly free and exactly
  correct; linear-only avoids inter-invocation dependency analysis; redo
  doubles the protocol for little demo value.
- **Consequences:** Redo/selective undo become future work with the
  invocation log as substrate; snapshot semantics under concurrent ticks
  documented prominently (§7.4).
- **Status:** proposed

### Decision D5: Invocation log lives in core and is clock-free

- **Context:** Where do records live; who timestamps?
- **Options considered:** (a) app-side; (b) core with `Date.now()`;
  (c) core with monotonic `seq`.
- **Decision:** (c).
- **Rationale:** Every app needs the log (else no transcript-menu undo);
  core stays deterministic and testable without a clock.
- **Consequences:** `<ActivityPane>` shows sequence order; apps stamp wall
  time at print time if desired.
- **Status:** proposed

## 9. Implementation plan

**Phase A1 — builder (2 days).** `core/src/builder.ts` (descriptors,
`Resolved<A>`, compile + resolve-wrapper), `engine.failInvocation`, tests:
equivalence fixture (§10.1), stale-abort golden, `@ts-expect-error`
type-tests.

**Phase A2 — migrate e-commerce (1 day).** Rewrite
`apps/demos/src/demos/ecommerce/engine.ts` on the builder; delete
`val`/`refId`/`orderIs`; the CLIM-JSX-003 diary's verified flows are the
regression checklist. Record the line/cast diff in the diary.

**Phase A3 — invocations + undo (2 days).** `core/src/invocation.ts`,
execute-bracketing, `installUndoCommands`, invocation ptype + echo parts,
`chrome/src/activity.tsx`; e-commerce adds `api.snapshotUndo` to
lifecycle/product commands. Verify: Fulfill → Undo restores order status
*and* stock; transcript right-click → Undo.

**Phase A4 — menus + announcements + listener (1–2 days).** menu.tsx
rewrite (roles, arrows, type-ahead, focus return); live regions; input
history; `user-select` fix. RTL tests for menu keyboard operation.

**Phase A5 — roving focus + keyboard accepts (2–3 days).** Engine `focus`
state + `eligibleList()`; `usePresentation` key handlers + pane cursor;
Tab-cycling during accepts; docline treats focus as hover. E2E: complete
a full Compare Sites flow in care-examiner with keyboard only.

**Phase A6 — docs (half day).** Update `apps/demos/PORTING-NOTES.md`
(builder style becomes the recommended recipe) and the README.

## 10. Testing strategy

1. **Behavioral equivalence:** one fixture command table defined both v1
   and builder-style; identical scripted interactions must produce
   byte-identical transcripts.
2. **Type-level tests:** `builder.types.test.ts` with `@ts-expect-error`
   (wrong arg key, wrong resolved type, world type flowing into
   `appliesTo`).
3. **Undo properties:** for each undoable e-commerce command: capture
   pre-state → run → undo → deep-equal (valid because stores are
   immutable). Linear-only refusal test. Failed commands leave no undo.
4. **Keyboard e2e:** mouse-free Playwright runs of one full flow per demo
   (write them in CLIM-JSX-005's checked-in harness).
5. **A11y checks:** axe-core pass with menu open and closed; RTL asserts
   `role`/`aria-live` presence and menu focus-return.

## 11. Risks, alternatives, open questions

- **Risk:** builder type gymnastics can produce hostile error messages.
  Mitigation: keep descriptors monomorphic; add a "three most common type
  errors" section to PORTING-NOTES.
- **Risk:** snapshot undo vs. concurrent ticks (§7.4) — restate loudly in
  API docs; live-tick demos prefer explicit inverses.
- **Risk:** hover-driven live-region chatter even debounced — schedule one
  real screen-reader session before closing §6.4.
- **Open:** single-letter keys (`d`/`m`) active only while a presentation
  is focused (proposed) or global-with-modifier? Decide in A5.
- **Open:** does an invocation part in every echo line make transcripts
  noisy? Fallback: attach the invocation to the line's context menu with
  no visible text change.
- **Alternative rejected:** commands-as-data + interpreter (full
  event-sourcing). Right shape for replay/redo, far beyond current need;
  the invocation log is the stepping stone if we ever go there.

## 12. References

- `packages/core/src/command.ts` — ArgSpec/CommandSpec (`world: unknown`
  callbacks :25-33; CommandApi :40-47; define :70-78).
- `packages/core/src/engine.ts` — accept loop :177-282; execute :283-289;
  gesture routing :414-451; eligible/inert :155-173; choice menus :316.
- `packages/react/src/use-presentation.ts` — gesture props :96-127;
  hardcoded aux :115-119; state flags :86-88.
- `packages/react/src/provider.tsx` — global Escape :20-27.
- `packages/chrome/src/menu.tsx` (70 lines), `packages/chrome/src/mouse-doc.tsx`.
- `packages/listener/src/listener.tsx` — key handling :34-46.
- `packages/theme-genera/src/genera.css:24` — global `user-select: none`.
- `apps/demos/src/demos/ecommerce/engine.ts` — migration target (helpers
  :43-44; casts :56-90; lifecycle predicate :52-53; Refund :243-262).
- `apps/demos/src/lib/store.ts` — immutable store enabling snapshot undo.
- CLIM-JSX-001 design doc §6.5 (reserved CommandInvocation); thesis
  command applications:
  `ttmp/2026/07/12/CLIM-JSX-001--*/sources/aitr-794.md:1537-1545`.
- CLIM-JSX-002/003 diaries — where the authoring pain and missing undo
  were recorded during app development.

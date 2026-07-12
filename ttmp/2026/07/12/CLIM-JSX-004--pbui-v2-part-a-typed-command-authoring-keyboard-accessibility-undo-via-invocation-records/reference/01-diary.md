---
Title: Diary
Ticket: CLIM-JSX-004
Status: active
Topics:
    - pbui
    - react
    - typescript
    - design
DocType: reference
Intent: long-term
Owners: []
ExternalSources: []
Summary: Implementation diary for part A — typed builder, keyboard/a11y, undo.
LastUpdated: 2026-07-12T19:25:18.037413239-04:00
WhatFor: "Record the implementation of the CLIM-JSX-004 phases with failures and verification."
WhenToUse: "Read before continuing part A work."
---

# Diary

## Goal

Implement the CLIM-JSX-004 design (typed command builder, keyboard and
accessibility layer, undo via invocation records), phase by phase.

## Step 1: Phase A1 — the typed command builder

Built `packages/core/src/builder.ts` exactly on the design's D1/D2 shape:
argument descriptors carrying phantom types, an object-of-descriptors
whose insertion order is the accept order, a `ResolvedArgs<A>` mapped
type, and compilation down to the untouched v1 `CommandSpec` runtime with
a resolve-then-run wrapper.

### Prompt Context

**User prompt (verbatim):** "ok, implement them, task by task, keeping a detailed diary as you work"

**Assistant interpretation / intent:** execute the design docs.

**Commit (code):** 73fde62 — ":sparkles: A1+B1(core): typed command
builder, golden transcripts, CI workflow"

### What I did

- Additive core changes: `ResolveFn` threaded as an optional 4th argument
  through every spec-callback call site in the engine
  (`where`/`validate`/`options`/`default`/`appliesTo`), a bound
  `engine.resolveFn`, `engine.failInvocation(cmdName, ...reason)` printing
  the standardized "… presentation was stale; <Command> aborted." line,
  and `api.fail` wired through `makeApi(cmd)`.
- `builder.ts`: `arg.presentation<T>(ptype, {where, validate, distinct,
  allowStale})`, `arg.text({default, validate})`, `arg.number({min, max,
  integer, default, validate})`, `arg.choice<T>({options})`;
  `commandBuilder(table).define({name, args, appliesTo, run})`. The run
  wrapper resolves all values (entities via the Resolver, immediates by
  unwrapping), aborts on the first stale entity, then calls the typed
  body. `appliesTo` and `where` receive resolved objects.
- 7 tests in `builder.test.ts`: v1-vs-builder equivalence asserted by
  byte-identical rendered transcripts and world logs; central stale
  abort; number sugar (min/max/integer) + default-on-empty-Enter;
  resolved `where` + `distinct` eligibility; resolved `appliesTo`
  filtering menus; choice menus delivering typed values; type-level
  `@ts-expect-error` cases.

### Why

- Compile-to-v1 (decision D1) meant the engine diff stayed under 30
  lines and all six demos keep working untouched.

### What worked

- All 38 core tests green (28 v1 + 7 builder + 3 golden); the golden
  files did not change — the builder is behaviorally invisible.

### What didn't work

- `tsc` rejected the `ChoiceOpts → Record<string, unknown>` direct cast
  (no index signature); fixed with an `as unknown as` two-step.

### What was tricky to build

- **Deviation from the design doc:** descriptor callbacks (`where`,
  `validate`, `options`, `default`) receive `soFar` typed as
  `Partial<ResolvedArgs<any>>` rather than the fully inferred
  `Partial<ResolvedArgs<A>>` — descriptors are constructed before `A`
  exists (the object literal that defines `A` contains them), a
  chicken-and-egg the doc's sketch glossed over. The candidate value
  itself IS typed (`arg.presentation<Ship>` → `where: (ship: Ship, …)`),
  and authors can annotate `soFar` params contextually. A curried
  `args(builder => …)` API could close the gap later; noted as follow-up.
- `api.resolve` takes an ArgValue, but the wrapper has bare refs; wrapped
  as `{type: "", ref, label: ""}` since only `.ref` is used. Slightly
  smelly; if it bothers reviewers, add `api.resolveRef(ref)` to
  CommandApi.

### What warrants a second pair of eyes

- The `soFar` typing deviation above.
- `failInvocation`'s message format is now golden-adjacent (used by
  builder tests) — changing it later is a breaking test change.

### What should be done in the future

- A2 (e-commerce migration) next; A3 invocation records hook into
  `failInvocation` and `execute`.

### Code review instructions

- `packages/core/src/builder.ts` top-to-bottom (~280 lines), then
  `builder.test.ts`. Validate: `pnpm --filter @pbui/core test &&
  pnpm --filter @pbui/core typecheck`.

## Step 2: Phase A3 — invocation records, linear undo, live history

Implemented out of the doc's order (A3 before A2) because the e2e agent
still owned `apps/demos` — the invocation layer is core/chrome/listener
only, and it was designed to make **zero transcript text changes** so the
goldens and the in-flight e2e transcription stayed valid.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Commit (code):** 017b51d — ":sparkles: A3: invocation records, linear
undo, ActivityPane, live command history"

### What I did

- `core/src/invocation.ts`: `CommandInvocation` (clock-free `seq` per
  decision D5, `echoLineId` linkage) + capped, subscribable
  `InvocationLog`.
- Engine: `execute` brackets `cmd.run` with record/complete/fail;
  `startCommand*` capture their echo line's id; `api.undoable(capture)`
  and `api.snapshotUndo(store)` collect the inverse;
  `engine.undoInvocation(id?)` is linear-only with coaching ("Undo is
  linear — undo X first"); `api.fail` marks the invocation failed.
- Invocation refs resolve from the engine's own log (`resolveFn` checks
  `kind === "invocation"` before delegating) — **no app resolver changes
  needed** for invocation presentations to work.
- `installUndoCommands(engine)`: global `Undo`, the `invocation` ptype
  (print/describe), and `Undo Invocation` whose `appliesTo` checks
  undoability through the new resolve parameter.
- Listener: echo lines with invocations render as `quiet` invocation
  presentations — right-click a past command in the transcript to undo
  it (the "history is made of presentations" move).
- `chrome/src/activity.tsx`: `<ActivityPane>` with status glyphs.
- 7 tests: lifecycle + echo linkage, thrown-error failures, non-opt-in
  commands not undoable, snapshot undo restoring the **identical** state
  object, explicit-inverse undo, linearity refusal then sequential
  unwinding, nothing-to-undo.

### Why (design deviation worth knowing)

- The design doc floated an invocation *part* inside every echo line and
  flagged noise as an open question. Implemented the fallback instead:
  the transcript record carries no extra text; the listener wraps the
  whole line as a quiet presentation via `invocations.byEchoLine`. Zero
  golden churn, and hovering a past command self-documents in the doc
  line.

### What was tricky to build

- Echo-to-invocation linkage across the accept loop: the echo happens at
  `startCommand` but execution may happen much later (after arguments).
  A `pendingEchoLineId` field bridges them; it is consumed exactly once
  at `execute`.
- Undo capture with async runs: a per-execution `undoRef` closure passed
  through `makeApi`, read after `await cmd.run` — avoids any
  "current invocation" mutable engine state.

### What warrants a second pair of eyes

- Snapshot undo restores the WHOLE store — concurrent tick mutations
  revert too (documented in the design doc §7.4); live-tick demos should
  use explicit inverses.
- Every echo line now sets hover state when moused (doc line shows
  `#<INVOCATION …>`); verify this reads as self-documenting rather than
  noisy in real use.

### Code review instructions

- `core/src/invocation.ts` + engine execute/makeApi diff +
  `invocation.test.ts`; then `listener.tsx` line-wrapping and
  `chrome/activity.tsx`.

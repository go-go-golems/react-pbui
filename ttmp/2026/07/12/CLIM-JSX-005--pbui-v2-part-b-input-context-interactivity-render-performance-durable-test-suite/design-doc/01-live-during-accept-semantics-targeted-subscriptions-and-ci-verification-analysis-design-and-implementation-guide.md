---
Title: 'Live-during-accept semantics, targeted subscriptions, and CI verification: analysis, design, and implementation guide'
Ticket: CLIM-JSX-005
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
    - Path: repo://packages/core/src/engine.ts
      Note: Gesture gating and monolithic state — both redesigned here
    - Path: repo://packages/react/src/use-presentation.ts
      Note: The whole-state subscription this design replaces with targeted ones
    - Path: repo://packages/core/src/registry.ts
      Note: Grows indices, per-presentation events, and the eligible-set cache
    - Path: repo://apps/demos/src/demos/schema/SchemaDemo.tsx
      Note: Click-fall-through gap (PORTING-GAPS header)
    - Path: repo://apps/demos/src/demos/ecommerce/EcommerceDemo.tsx
      Note: Tab-navigation-during-accept gap (PORTING-GAPS header)
ExternalSources: []
Summary: "Design for @pbui v2 part B: presentation participation modes and command flags that keep navigation and canvases live during input contexts; targeted per-presentation subscriptions plus a cached eligible set to fix the O(n) hover re-render storm; and a durable, checked-in verification suite (Playwright e2e, RTL, golden transcripts, CI)."
LastUpdated: 2026-07-12T19:01:01.185569606-04:00
WhatFor: "Implementation guide for the CLIM-JSX-005 workstream."
WhenToUse: "Read before touching engine gating, render performance, or the test infrastructure."
---

# Live-during-accept semantics, targeted subscriptions, and CI verification — analysis, design, and implementation guide

*Audience: a new intern. Section 2 orients you in the codebase; every
`file.ts:NN` is a real line — read it alongside this doc. This ticket is
the sibling of CLIM-JSX-004 (typed commands, a11y, undo); they touch
different layers and can proceed in parallel, with two named coordination
points (§9.4).*

## 1. Executive summary

Three problems, one per layer:

1. **Semantics — the input context is a modal wall.** When a command is
   collecting an argument, the engine swallows *every* click that doesn't
   supply it (`engine.ts:423-431`). Two of six demo apps hit this wall and
   said so in their headers: the schema editor needed clicks to fall
   through presentations to the canvas during LOCATION accepts
   (`SchemaDemo.tsx:9-13`), and the e-commerce back office cannot switch
   tabs mid-command (`EcommerceDemo.tsx:11-15`). CLIM kept frame
   navigation and some translators live during accepts. We introduce
   **participation modes** on presentations (`gated` / `active` /
   `fallthrough`) and a **`duringAccept` flag** on commands, so
   navigation stays live and canvases receive clicks — without weakening
   the default modal behavior everywhere else.
2. **Performance — one hover move re-renders everything.** Every
   `usePresentation` subscribes to the whole engine state
   (`use-presentation.ts:48`), and eligibility re-walks the coercion
   table per presentation per render (`engine.ts:155-169`). At demo scale
   (~200 presentations) it's fine; at 1,000 rows it will not be. We split
   engine state into slices, give the registry **targeted
   per-presentation events**, and compute the **eligible set once** per
   accept/registry change. Hover then notifies exactly two components.
3. **Verification — proven once, protected never.** All demos were
   verified by driving a real browser, but those scripts lived in
   ephemeral tool calls; the React layer has zero automated tests, and
   nothing runs in CI. We check in the verification: a **Playwright e2e
   suite** encoding the recorded flows, an **RTL suite** for gesture
   routing and state classes, **golden transcript tests** in core, and a
   GitHub Actions workflow that runs all of it plus a performance budget.

Order matters: the test suite (§7) lands *first*, because §5 and §6
change the two most load-bearing behaviors in the engine and must be
pinned before surgery.

## 2. System orientation (read this if you're new)

@pbui implements CLIM-style presentation-based UIs. The 60-second version:

- Everything on screen that stands for a domain object is a
  **presentation** — registered in a **registry**
  (`packages/core/src/registry.ts`) as `{id, type, ref, label, bounds}`.
- **Commands** declare typed arguments. Invoking one with missing args
  starts an **input context** ("accepting"): the engine holds
  `state.accept = {cmd, values, spec}` and presentations whose type
  matches `spec` become *eligible* (marching-ants outline) while all
  others go *inert* (dimmed, `pointer-events: none` via the
  `.pbui-inert` class in `packages/theme-genera/src/genera.css`).
  Clicking an eligible presentation supplies the argument
  (`engine.ts:218-282`).
- React binds via `usePresentation`
  (`packages/react/src/use-presentation.ts`), which registers the record,
  returns gesture handlers, and derives `isHovered / isEligible / isInert`
  every render.
- Six demo apps live in `apps/demos/src/demos/`; `pnpm demos` serves them.

Deeper background: the CLIM-JSX-001 design doc
(`ttmp/2026/07/12/CLIM-JSX-001--*/design-doc/01-*.md`), Sections 3 and 6.

## 3. Current-state analysis (evidence)

### 3.1 The modal input context

The gate is five lines:

```ts
// engine.ts:423-431
case "click": {
  if (this.state.accept) {
    if (this.eligible(pres)) this.supply(pres);
    // ineligible: swallow (the doc line explains why)
    return;
  }
  this.defaultAction(pres);
  break;
}
```

and its CSS accomplice `.pbui-inert { pointer-events: none }`. Both apps
that fought it document the cost:

- **Schema editor** (`apps/demos/src/demos/schema/SchemaDemo.tsx:9-13`):
  during a LOCATION accept, clicking *on top of* an existing instance
  should place at that point (the original prototype's SPres let events
  fall through, `sources/schema-schematic-editor.jsx:339-343`); @pbui
  presentations `stopPropagation` unconditionally
  (`use-presentation.ts:100,111`), so the port added pin→location and
  wire→node coercions as a workaround.
- **E-commerce** (`apps/demos/src/demos/ecommerce/EcommerceDemo.tsx:11-15`):
  VIEW tabs are presentations; mid-accept they're inert, so if the
  customer you want isn't visible in the current tab you must abort,
  navigate, restart. The CLIM-JSX-003 diary calls this out as the
  second finding pointing at the same design area.

Also affected: right-click during an accept always aborts
(`engine.ts:435-439`) — reasonable, but it means *no* menu is reachable
mid-command, which the participation modes must keep in mind.

### 3.2 The O(n) hover storm

Two compounding costs:

1. **Whole-state subscription.** `usePresentation` calls
   `useEngineState()` (`use-presentation.ts:48`), which
   `useSyncExternalStore`s the entire `EngineState`
   (`provider.tsx:37-44`). `setState` notifies every listener
   (`engine.ts:116-119`). A mousemove that changes hover therefore
   re-renders **every mounted presentation**, plus the doc bar and
   status line. With N presentations, each mousemove is O(N) component
   renders; sweeping the mouse across a row of 1,000 is O(N·moves).
2. **Per-render eligibility.** Each of those renders calls
   `engine.eligible()` (`use-presentation.ts:86-87`), which runs
   `coerceFor` — a subtype walk plus a scan of the coercion list
   (`engine.ts:137-152`) — and the `distinct` ref-comparison loop. The
   answer only changes when the accept state or the registry changes,
   not per render.

Measured intuition (not yet benchmarked — the benchmark is deliverable
§6.4): the care-examiner demo re-renders ~120 presentations per hover
change at 60Hz mousemove; a 1,000-row back office would do 8× that work
per event.

### 3.3 Verification is not durable

- The five demos were verified end-to-end with Playwright (menus, accept
  partitioning, echo grammar, transcript liveness), but the scripts exist
  only in session logs; the diaries record *results*, not runnable
  artifacts.
- `packages/react`, `chrome`, `listener` have **zero** automated tests
  (only `packages/core` has a vitest suite — 28 cases,
  `core.test.ts`).
- The CLIM-JSX-001 design doc promised golden-transcript tests (§10.3)
  and Storybook stories (§9 Phase 2); neither exists.
- There is no CI at all: `pnpm test && pnpm typecheck` runs only when a
  human remembers.

Two production bugs were found *only* by the browser sessions (docline
crashing on custom printers; positional args bypassing validation — see
the CLIM-JSX-001 diary, Step 7), which is exactly why this must be
automated before §5/§6 rework the engine internals.

## 4. Gap analysis

| # | Gap | Evidence | Fixed by |
|---|-----|----------|----------|
| G1 | All clicks gated by accept; navigation dead mid-command | engine.ts:423-431; EcommerceDemo.tsx:11 | `active` mode + `duringAccept` (§5.2-5.3) |
| G2 | No click-fall-through to canvases during accepts | SchemaDemo.tsx:9-13 | `fallthrough` mode (§5.4) |
| G3 | Right-click mid-accept always aborts; no menus reachable | engine.ts:435-439 | scoped menu for `active` presentations (§5.5) |
| G4 | Hover re-renders all presentations | use-presentation.ts:48; engine.ts:116 | state slices + targeted events (§6.1-6.2) |
| G5 | Eligibility recomputed per presentation per render | engine.ts:137-169 | cached eligible set (§6.3) |
| G6 | No perf budget or benchmark | §3.2 | bench harness + CI budget (§6.4) |
| G7 | Browser verification not checked in; React layer untested; no CI | §3.3 | e2e + RTL + golden + Actions (§7) |

## 5. Design A: participation modes — what stays live during an accept

### 5.1 The model

Today a presentation has exactly one behavior during a foreign accept:
gated. We make participation explicit:

```
                         input context ACTIVE, presentation NOT eligible
                    ┌─────────────────────────────────────────────────────┐
 mode "gated"       │ dimmed (.pbui-inert), pointer-events none, clicks   │
 (default, today's) │ swallowed by engine                                 │
                    ├─────────────────────────────────────────────────────┤
 mode "active"      │ fully interactive: hover doc works, left-click runs │
                    │ its default command IF that command is marked       │
                    │ duringAccept-safe; the accept context SURVIVES      │
                    ├─────────────────────────────────────────────────────┤
 mode "fallthrough" │ visually normal but transparent to gestures: no     │
                    │ stopPropagation, no engine routing — events reach   │
                    │ whatever is underneath (canvas, pane background)    │
                    └─────────────────────────────────────────────────────┘
 (eligible presentations behave as today in every mode: click supplies)
```

API surface:

```ts
usePresentation({ type, ref, label, duringAccept?: "gated"|"active"|"fallthrough" })
// <Presentation duringAccept="active" …> etc.
```

### 5.2 `active` presentations and `duringAccept` commands

An `active` presentation's left-click mid-accept routes to its default
command as usual (`engine.defaultAction`, `engine.ts:463-470`) **only if**
that command opts in:

```ts
// command.ts addition
export interface CommandSpec<W> {
  ...
  /** may run while an input context is pending, without aborting it */
  duringAccept?: boolean;
}
```

Engine change (the gate at `engine.ts:423-431` becomes):

```
click(pres):
  if accept:
    if eligible(pres)            -> supply(pres)              (unchanged)
    else if pres.mode == "active":
      cmd = defaultCommandFor(pres)
      if cmd?.duringAccept and argsSatisfiableBySeed(cmd, pres):
        executeImmediate(cmd, seed=pres)     # NO advance(), NO accept touch
      else: swallow (doc line explains: "finish or Esc the pending command")
    else                          -> swallow                   (unchanged)
```

Constraints that keep this sane:

- `executeImmediate` requires the seed to satisfy **all** required args
  (in practice: single-presentation-arg commands like `Switch To View`,
  `Show Order`). A `duringAccept` command that would itself need an
  accept is refused at `define` time — one accept context at a time is an
  invariant we keep (Decision D2).
- The pending accept's eligible/inert visuals stay as they are;
  `active` presentations render normally (no dim, no ants).
- The e-commerce fix is then two lines: `duringAccept: true` on
  `Switch To View`, `duringAccept: "active"` on the TabBar presentations.
  Mid-`New Order`, the clerk can flip to Customers, click the customer
  (eligible presentations exist there), and continue.

### 5.3 Doc-line integration

`pointerDoc` (`packages/core/src/docline.ts:10-33`) gains one branch:
hovering an `active` presentation during an accept yields
`"L: Switch To View (the pending New Order keeps waiting)"` — the doc
line is how users learn the mode exists. Hovering a gated one keeps
today's "not applicable here" coaching.

### 5.4 `fallthrough` presentations

For the schema-editor case the presentation should get *out of the way*:
when an accept is active and the presentation is not eligible,
`usePresentation` returns handlers that do nothing and do **not**
`stopPropagation`, plus `pointer-events: none` on the element itself but
NOT the inert dimming — implemented as a distinct class `.pbui-passthru`
(visually normal, gesture-transparent). The SVG canvas underneath then
receives the click and supplies the LOCATION exactly as the original
prototype did (`sources/schema-schematic-editor.jsx:339-343`). Outside
accepts, `fallthrough` behaves like `gated` (i.e., normal).

The schema port's workaround coercions (pin→location) stay — they're
good UX — but stop being load-bearing; its PORTING-GAPS header is deleted
as part of §8 Phase B3.

### 5.5 Menus during accepts

Right-click on an `active` presentation mid-accept opens a **reduced
menu**: only `duringAccept` commands applicable to it, plus the standard
Abort footer. Right-click anywhere else keeps today's abort semantics
(`engine.ts:435-439`) — muscle memory from six demos says right-click =
abort, and we don't break it.

## 6. Design B: targeted subscriptions and the eligible-set cache

### 6.1 Slice the engine state

`EngineState` (`engine.ts:88-93`) currently notifies one listener set for
any change. Split the notification channels (state object stays one
object; only subscription granularity changes):

```ts
type Slice = "hover" | "accept" | "menu" | "transcript";
subscribe(slice: Slice, fn: () => void): Unsubscribe
// legacy subscribe(fn) == subscribe-all, kept for compatibility
```

Consumers re-bind: doc bar → hover+accept+menu; status line →
accept+menu; listener → transcript+accept; menu host → menu. The expensive
consumer — `usePresentation` — stops subscribing to slices entirely and
uses per-presentation events (§6.2).

### 6.2 Per-presentation notification

The registry (`registry.ts`) becomes the render-invalidation channel:

```ts
// registry additions
notifyPres(id: PresId): void;                       // bump per-id version
subscribePres(id: PresId, fn: () => void): Unsubscribe;
presVersion(id: PresId): number;                    // getSnapshot fodder
```

`usePresentation` subscribes to *its own id only*:

```ts
const flags = useSyncExternalStore(
  (fn) => registry.subscribePres(myId, fn),
  () => registry.presFlags(myId),   // {hovered, eligible, inert, related} version-cached
);
```

Engine responsibilities on state transitions:

```
hover: A -> B          notifyPres(A); notifyPres(B)
                       plus byRef(A.ref)/byRef(B.ref) for the related-
                       hover outline (bounded by presentations-per-object)
accept: null -> ctx    recompute eligible set (§6.3); notify the union of
accept: ctx -> null    old/new eligible ids... which is everyone whose
                       FLAGS changed: eligible ids + (inert applies to all
                       others) -> on accept transitions a full broadcast
                       is still correct and acceptable (rare), so:
                       accept transitions: notifyAll()
                       hover transitions:  targeted (the hot path)
```

The asymmetry is the point: accept changes are user-paced (a few per
minute) and may broadcast; hover changes are mouse-paced (dozens per
second) and must be O(presentations-of-two-objects), not O(N).

### 6.3 The eligible-set cache

Replace per-render `eligible()` calls with a set computed once per
(accept-spec, values, registry-generation):

```ts
// engine internals
private eligibleCache: { key: string; ids: Set<PresId> } | null;

recomputeEligible(): void {
  const acc = this.state.accept;
  if (!acc) { this.eligibleCache = null; return; }
  const ids = new Set<PresId>();
  for (const rec of this.registry.all())
    if (this.eligibleUncached(rec)) ids.add(rec.id);   // today's logic, engine.ts:155-169
  this.eligibleCache = { key: acceptKey(acc), ids };
}
// public reads become O(1):
eligible(rec) { return this.eligibleCache?.ids.has(rec.id) ?? false; }
```

Recompute triggers: accept start/advance/abort; registry
register/unregister/update *while* an accept is active (subscribe to
registry events, `registry.ts:83-87`). Presentations registered
mid-accept (e.g. transcript lines printed during the context) get
evaluated on registration — this preserves the "printed names become
supplyable" behavior verified in the demos.

`eligibleList()` for CLIM-JSX-004's keyboard Tab-cycling reads the same
set — the coordination point named in that doc.

Note: `eligible()` currently accepts unregistered pseudo-records
(engine tests construct them ad hoc, and `PartView` transcript parts
render before registration completes). Keep `eligibleUncached` public as
`eligibleOf(recLike)` for those cases; the hook uses the cached path.

### 6.4 Benchmark harness and budget

New demo route `#bench` (excluded from the launcher list): renders N
configurable presentations (default 2,000) in a grid plus one accept
toggle. A Playwright perf spec drives 100 synthetic mousemoves across the
grid and asserts via the DevTools protocol:

- ≤ 25 component renders per hover transition (2 presentations + doc bar
  + status + slack), measured with a render counter injected in dev
  builds (`usePresentation` increments `window.__pbuiRenders` when
  `import.meta.env.DEV`).
- p95 input-to-paint under 16ms on the CI runner for N=2,000.

The budget numbers are provisional until first measurement; the *shape*
(counter + threshold in CI) is the deliverable. Before/after numbers go
in the ticket diary.

## 7. Design C: the durable verification suite

### 7.1 Layout

```
apps/demos/e2e/
  playwright.config.ts        # webServer: vite preview, port 5199
  helpers.ts                  # menuItem(), transcriptLines(), eligibleCount(),
                              # rightClick(), promptType() — the vocabulary the
                              # recorded sessions already used
  hello.spec.ts               # compare-ships accept flow, distinct exclusion
  care-examiner.spec.ts       # typed validation, legend->threshold, transcript supply
  scheduler.spec.ts           # lattice menu, month accept, live transcript refs
  metrics.spec.ts             # two-click assign-port, plot toggle, hardcopy
  schema.spec.ts              # run-spice, probe from transcript, draw-instance w/ location
  gallery.spec.ts             # rename, set-attribute, where-constrained untag, filters
  ecommerce.spec.ts           # lifecycle menus, new-order chain, stock validation
  bench.spec.ts               # §6.4 budget (tagged @perf, separate CI job)
packages/react/src/__tests__/
  gesture-routing.test.tsx    # click/aux/context/hover routing into a mock engine
  state-classes.test.tsx      # hover/eligible/inert/related class application
  registration.test.tsx       # register on mount, unregister on unmount, StrictMode
  menu.test.tsx               # (chrome) items, clamping call, Abort footer
  listener.test.tsx           # prompt states, Enter submit, history (after 004-A4)
packages/core/src/__golden__/
  compare-sites.txt           # golden transcripts: scripted engine interactions
  abort-everywhere.txt        #   rendered to text via a canonical serializer
  command-line.txt
  golden.test.ts
```

### 7.2 The e2e specs are the recorded sessions, formalized

Every assertion in the seven spec files already exists as a verified
result in the CLIM-JSX-001/002/003 diaries — the work is transcription
into `@playwright/test` with the shared helpers, not invention. Two rules
learned from the recording sessions, encoded in `helpers.ts`:

- always `page.reload()` after hash navigation (same-document `goto`
  does not remount — bit us twice);
- menu items are selected by exact-regex on `.pbui-menu-item` text
  ("Tag Image …" vs "Untag Image …" strict-mode collision).

### 7.3 Golden transcripts

Core gains a canonical transcript serializer (`renderTranscript(lines) →
string` — parts rendered as `[TYPE label]` for pres parts, `**bold**`,
plain text). Golden tests script the engine directly (no DOM):
start command → supply via fake records → typed input → abort — then
compare against the checked-in `.txt`. The echo grammar becomes a
*specification*, not an implementation detail; §5/§6 refactors must not
move a single character of it. Update procedure: `vitest -u`-style flag
regenerates, diff reviewed like a snapshot.

### 7.4 CI

`.github/workflows/ci.yml`:

```yaml
jobs:
  checks:   pnpm install --frozen-lockfile; pnpm typecheck; pnpm test
  e2e:      needs checks; npx playwright install --with-deps chromium;
            pnpm --filter @pbui/demos build; npx playwright test (excluding @perf)
  perf:     needs e2e; runs @perf only; continue-on-error: true for the
            first two weeks (budget calibration), then enforced
```

The repo-local `.npmrc` (`store-dir=.pnpm-store`) already makes installs
hermetic. Playwright browsers cached via `actions/cache` keyed on the
Playwright version.

## 8. Decision records

### Decision D1: Three participation modes, gated remains the default

- **Context:** Two apps need non-modal behavior; four are fine.
- **Options considered:** (a) global "soft accept" (nothing gates);
  (b) per-presentation modes; (c) per-command "reachable sets".
- **Decision:** (b) with (c)'s spirit in the `duringAccept` command flag.
- **Rationale:** The wall is *usually right* — dimming everything is what
  makes accepts legible (verified repeatedly: eligible/inert partitioning
  is the paradigm's best teaching device). The exceptions are structural
  (navigation, canvases), which presentations know about themselves.
- **Consequences:** A third state-class (`pbui-passthru`) in the theme;
  mode is per-presentation *instance*, so the same VIEW object can be
  gated in one pane and active in the tab bar.
- **Status:** proposed

### Decision D2: One input context at a time — `duringAccept` commands must be seed-complete

- **Context:** An `active` command needing its own accept would stack
  contexts.
- **Options considered:** (a) context stack with resume; (b) refuse
  multi-arg duringAccept commands at define time.
- **Decision:** (b).
- **Rationale:** Context stacks are the single biggest complexity cliff in
  this design space (prompt lines, doc lines, abort semantics, and the
  eligible-set cache all become stacks). No current use case needs it —
  navigation commands are all single-seed.
- **Consequences:** `define` throws on `duringAccept: true` with >0
  unseedable args; the error message names this decision. If a real need
  appears, the invocation log (CLIM-JSX-004) plus this refusal are the
  starting points for a designed stack.
- **Status:** proposed

### Decision D3: Hover is targeted; accept transitions may broadcast

- **Context:** Full per-flag dependency tracking vs. pragmatic split.
- **Options considered:** (a) broadcast everything (status quo);
  (b) fine-grained reactive graph (signals); (c) targeted hover +
  broadcast accept.
- **Decision:** (c).
- **Rationale:** Hover is the only mouse-frequency event; accept
  transitions are user-paced and *do* legitimately change most
  presentations' flags (inert applies to everyone). (b) would import a
  reactivity system for one hot path.
- **Consequences:** Accept start/stop stays O(N) renders — acceptable and
  now measured (§6.4); if the benchmark disagrees later, (b) has a
  contained landing zone in `presFlags`.
- **Status:** proposed

### Decision D4: Eligibility caching keyed on accept + registry generation

- **Context:** Where to memoize eligibility.
- **Options considered:** (a) per-presentation memo in the hook;
  (b) engine-level set recomputed on relevant transitions; (c) lazy
  memo with invalidation tokens.
- **Decision:** (b).
- **Rationale:** The hook can't know when coercions/`where` results
  change; the engine owns every input to the answer. A set also directly
  feeds `eligibleList()` for keyboard cycling (CLIM-JSX-004 §6.2).
- **Consequences:** `where` predicates are now evaluated eagerly per
  accept transition for all candidate-typed presentations — document that
  they must stay cheap and pure; registry churn during accepts (transcript
  prints) triggers incremental adds, not full recomputes.
- **Status:** proposed

### Decision D5: Tests land before the engine changes

- **Context:** §5 and §6 rewrite gesture gating and subscriptions — the
  two behaviors every demo depends on.
- **Options considered:** (a) refactor first, test after; (b) pin with
  e2e + golden first.
- **Decision:** (b); Phase B1 is the test suite.
- **Rationale:** The two historical core bugs were caught only in the
  browser (§3.3); refactoring the exact same area without those checks
  reproduces the risk with interest.
- **Consequences:** ~2 days before any engine work starts; §5/§6 diffs
  then come with mechanical confidence (green suite + unchanged goldens).
- **Status:** proposed

## 9. Implementation plan

**Phase B1 — verification suite (2–3 days).** §7 in full: helpers, seven
e2e specs transcribed from the diaries, RTL suites, golden serializer +
three goldens, CI workflow. Exit: CI green on main, twice in a row.

**Phase B2 — performance (2–3 days).** Slices (§6.1), per-presentation
events + `presFlags` (§6.2), eligible-set cache (§6.3), `#bench` route +
perf spec (§6.4). Exit: unchanged e2e/goldens; before/after render counts
in the diary; budget wired in CI (calibration mode).

**Phase B3 — participation modes (2–3 days).** `duringAccept` on
CommandSpec + define-time refusal (D2), gesture-gate rework (§5.2),
`fallthrough` handlers + `.pbui-passthru` (§5.4), doc-line branch (§5.3),
reduced menus (§5.5). Apply: e-commerce tabs (`active` +
`duringAccept: true` on Switch To View / Show *), schema canvas overlays
(`fallthrough`), then delete both PORTING-GAPS headers and extend the two
e2e specs with the previously-impossible flows (switch tab mid-New-Order;
place a component on top of an instance).

**Phase B4 — docs (half day).** PORTING-NOTES: participation-mode
guidance ("default gated; tabs/nav → active; canvas decor → fallthrough");
README test badge; update CLIM-JSX-001 doc's §6/§10 with an as-built note
pointing here.

Coordination with CLIM-JSX-004 (parallel-safe): (1) `eligibleList()` is
provided here (B2), consumed there (A5) — land B2 first or stub it;
(2) keyboard e2e specs from 004-A5 are written in this ticket's harness
(B1 must land first); (3) golden transcripts pin the echo grammar that
004's builder equivalence tests also rely on — shared fixture welcome.

## 10. Testing strategy

(§7 *is* the test strategy for the repo; this section covers testing the
changes of §5–§6 themselves.)

1. **Gating matrix test (core):** for each mode × {eligible, ineligible}
   × {accept active, idle} × gesture — a table-driven vitest asserting
   supply/execute/swallow/propagate. 24 rows; the spec of §5 in
   executable form.
2. **duringAccept invariants:** context survives an `executeImmediate`;
   prompt line and eligible set unchanged after it; define-time refusal
   throws.
3. **Fallthrough:** RTL — click on a passthru presentation reaches the
   element beneath (jsdom + explicit hit testing through the handler
   contract, plus the schema e2e for the real thing).
4. **Subscription accounting:** unit test on the registry — hover
   transition notifies exactly the ids of old/new hover + their byRef
   sets; accept transition notifies all; unsubscribe leaks none (listener
   set sizes checked).
5. **Cache correctness:** property-style vitest — for random command
   tables and registries, `cachedEligible(rec) ===
   uncachedEligible(rec)` across scripted accept lifecycles including
   mid-accept registrations.
6. **Perf budget:** the `#bench` spec (§6.4), calibrated then enforced.

## 11. Risks, alternatives, open questions

- **Risk: mode misuse.** Apps could mark everything `active` and lose the
  paradigm's legibility. Mitigation: PORTING-NOTES guidance + define-time
  refusal keeps `duringAccept` rare; the doc line always narrates what's
  pending.
- **Risk: eager `where` evaluation** (D4) — a slow or impure `where`
  now runs for every candidate on each accept transition. Document the
  contract; the bench page includes a pathological-`where` scenario.
- **Risk: e2e flake** — HMR/remount races bit the recording sessions.
  Mitigation: specs run against `vite preview` (no HMR), helpers
  encapsulate the reload rule; flaky-test quarantine tag from day one.
- **Open:** should `fallthrough` also apply to hover (currently: yes —
  no doc-line claim from passthru presentations during accepts)? Decide
  in B3 with the schema spec as arbiter.
- **Open:** budget numbers for the perf job (§6.4) are placeholders until
  first CI runs; calibrate, then enforce.
- **Alternative rejected: signals/fine-grained reactivity** for all
  engine state (D3) — heavier dependency and mental model than one hot
  path justifies; revisit only if the benchmark falsifies D3.

## 12. References

- `packages/core/src/engine.ts` — click gate :423-431; context/abort
  :432-438; state + setState :88-119; coerceFor/eligible :137-173;
  defaultAction :463-470.
- `packages/react/src/use-presentation.ts` — whole-state subscription
  :48; flag derivation :86-88; stopPropagation :100,111,117,123.
- `packages/react/src/provider.tsx` — useEngineState :37-44.
- `packages/core/src/registry.ts` — events/subscribe :83-87; byRef :57;
  at :66.
- `packages/core/src/docline.ts` — pointerDoc :10-33.
- `packages/theme-genera/src/genera.css` — `.pbui-inert` /
  `pointer-events: none`.
- `apps/demos/src/demos/schema/SchemaDemo.tsx:9-13` and
  `apps/demos/src/demos/ecommerce/EcommerceDemo.tsx:11-15` — the two
  PORTING-GAPS this ticket deletes.
- `sources/schema-schematic-editor.jsx:339-343` — the original
  fall-through behavior being restored.
- CLIM-JSX-001 design doc — §6.5, §9, §10 (promised Storybook/goldens);
  its diary Step 7 (the two browser-only bugs motivating D5).
- CLIM-JSX-003 diary Step 3 — the tab-navigation gap discovery.
- CLIM-JSX-004 design doc (sibling) — `eligibleList()` consumer, keyboard
  e2e, shared echo-grammar fixtures.

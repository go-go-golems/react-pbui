---
Title: Diary
Ticket: CLIM-JSX-005
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
Summary: Implementation diary for part B — verification suite, performance, participation modes.
LastUpdated: 2026-07-12T19:25:18.037413239-04:00
WhatFor: "Record the implementation of the CLIM-JSX-005 phases with failures and verification."
WhenToUse: "Read before continuing part B work."
---

# Diary

## Goal

Implement the CLIM-JSX-005 design (live-during-accept semantics, targeted
subscriptions, durable test suite), phase by phase, tests first.

## Step 1: Phase B1 — the durable verification suite

Per decision D5, the test suite lands before any engine surgery. The
infrastructure came up in this order: Playwright harness → one
hand-written spec to prove it → parallel agents for the remaining specs
and the RTL suites → golden transcripts → CI workflow.

### Prompt Context

**User prompt (verbatim):** "ok, implement them, task by task, keeping a detailed diary as you work"

**Assistant interpretation:** Execute both v2 design docs (CLIM-JSX-004 and
005) in their own phase order, with commits and diaries per phase.

**Inferred user intent:** Turn the two designs into working, protected code.

**Commit (code):** 73fde62 — ":sparkles: A1+B1(core): typed command
builder, golden transcripts, CI workflow"

### What I did

- `apps/demos/playwright.config.ts`: webServer runs `pnpm build && pnpm
  preview` — production build, no HMR (the recording sessions' flake
  source). Two projects: chromium (grepInvert @perf) and perf.
- `apps/demos/e2e/helpers.ts`: the shared vocabulary (openDemo with the
  mandatory reload, exact-text menuItem, pres/eligible locators,
  transcript/docBar/statusMode readers, submit).
- `apps/demos/e2e/hello.spec.ts`: 3 tests — full compare-ships accept
  flow with distinct exclusion (5 eligible of 6), escape-abort +
  command-line flow, middle-click describe + default action. All pass in
  3.2s against the preview build.
- Golden transcripts: `packages/core/src/transcript-text.ts` (canonical
  serializer — `[echo] **Command:** Compare Sites (site-a) {site
  SITE-ALPHA}`), `golden.test.ts` with three scripted scenarios
  (compare-sites, abort-everywhere, command-line) writing/checking
  `__golden__/*.txt`; regeneration via `GOLDEN_UPDATE=1`.
- `.github/workflows/ci.yml`: checks (typecheck+unit) → e2e (chromium,
  browser cache keyed on the Playwright version) → perf (calibration
  mode, continue-on-error).
- Fanned out two agents: one transcribing the six remaining demo specs
  from the diaries' verified flows, one building the RTL suites in
  packages/react (fixture + gesture-routing, state-classes,
  registration/StrictMode, menu, listener tests).

### Why

- Playwright pinned to **1.61.1** deliberately: its chromium revision is
  1228, exactly what the MCP plugin already cached in
  `~/.cache/ms-playwright` — zero downloads, and the sandbox's read-only
  `$HOME` is fine because only reads are needed.

### What worked

- The harness proved out first try: 3/3 hello tests green against the
  production preview.
- Goldens are stable across reruns (generated, then verified unchanged).

### What didn't work

- First run attempt failed with `no such file or directory:
  packages/core/src/index.ts` — the shell working directory was still
  `apps/demos` from the harness run; harmless, absolute paths fixed it.

### What was tricky to build

- Version archaeology: `@playwright/test` had to match the cached browser
  revision; `browsers.json` for v1.61.1 confirmed chromium=1228 before
  pinning.
- The golden serializer had to be added to core's public exports (it is
  the spec of the echo grammar, and apps/tools may want it), which means
  its format is now API.

### What warrants a second pair of eyes

- The CI perf job is `continue-on-error` until budgets are calibrated —
  don't forget to flip it (tracked in the design doc §6.4).
- The dev server was stopped in favor of preview-based testing; `pnpm
  demos` restarts it for interactive use.

### What should be done in the future

- B2 and B3 next, in that order, keeping goldens byte-identical.

### Code review instructions

- `cd apps/demos && pnpm exec playwright test --project=chromium`;
  `pnpm --filter @pbui/core test` (38 cases incl. goldens + builder).

## Step 2: Phase B1 landing — agents' suites

Both fan-out agents returned green: 6 new e2e spec files (19 tests,
transcribed from the diaries' verified flows, zero fixed sleeps, no
helper additions needed) and 5 RTL files (18 tests) with a fixture
mirroring core's. Combined suite at commit 6d38480: 22 e2e + 18 RTL +
38 core, all passing, twice.

Notable from the RTL agent's impedance report: `fireEvent.auxClick`
doesn't exist in @testing-library/dom v10 (worked around with a native
MouseEvent), and jsdom's zero-geometry makes `registry.at()` and menu
clamping untestable there (covered by core synthetic-bounds tests and
e2e respectively).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Commit (code):** 6d38480 — ":white_check_mark: B1 complete: 22 e2e
tests + 18 RTL tests"

## Step 3: Phase B2 — targeted subscriptions, eligible cache, measured

The performance rework landed exactly on the design's D3/D4 shape, then
was **measured**: at N=2,000 presentations, a hover transition costs
**1.98 presentation re-renders** (the old+new cells) against a budget of
25 — the pre-B2 architecture re-rendered all ~2,000.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Commit (code):** 4d2f3ae — ":zap: B2: targeted subscriptions,
eligible-set cache, bench budget"

### What I did

- Registry: `subscribePres/notifyPres/notifyAllPres` + per-id versions;
  a `refKey → ids` index making `byRef` O(presentations-of-that-object);
  unregister now cleans listener/version/index state.
- Engine: all accept mutations routed through `setAccept` (recomputes an
  eligible-id set once, broadcasts via `notifyAllPres` — accept changes
  are user-paced, D3); hover routed through `setHover` (notifies exactly
  old + new + their byRef sets — the mouse-paced hot path); a registry
  subscription keeps the eligible set incrementally correct when
  presentations register mid-accept (live-transcript supply preserved,
  proven by the care-examiner e2e). `eligible()` is O(1) for registered
  records with an uncached fallback for ad-hoc test fixtures;
  `eligibleList()` exists for A5's keyboard cycling.
- Hook: `usePresentation` now subscribes to its own id only (useReducer
  force + `subscribePres`); flags computed per render from engine state;
  a `window.__pbuiRenders` counter instruments every hook render.
- `#bench` hidden demo route (N=2,000 grid) + `@perf` spec.

### What didn't work

- **First bench run measured 0 renders and passed vacuously** — React 18
  batches synchronous dispatches, so all 100 mousemoves flushed after
  the loop. Fixed by awaiting a macrotask per transition AND adding a
  warm-up guard that fails the spec if the counter doesn't move at all
  (a vacuous pass can't recur silently).

### What was tricky to build

- The subscribe-before-register chicken-and-egg in the hook: the id only
  exists after the mount effect runs, so `useSyncExternalStore` (which
  wants a stable subscribe) gave way to `useReducer` force-updates wired
  inside the same effect that registers, with a post-registration
  `force()` so first-paint flags correct themselves.

### What warrants a second pair of eyes

- Accept transitions still broadcast (O(N) renders) by design (D3);
  the bench only budgets hover. If accept-transition cost ever matters,
  `presFlags`-level diffing is the contained next step.
- `where` predicates now run eagerly per accept transition over all
  candidate presentations — the documented "keep them cheap and pure"
  contract from the design doc applies for real now.

### Code review instructions

- Diff of registry.ts + engine.ts (setAccept/setHover) +
  use-presentation.ts; then `e2e/bench.spec.ts`. Validate: full suite +
  `pnpm --filter @pbui/demos exec playwright test --project=perf`.

## Step 4: Phase B3 — the modal wall comes down

Participation modes landed exactly on the design's §5: core first
(commit 00774ff — modes on PresentationRecord, `duringAccept` on
CommandSpec with the D2 define-time seed-complete refusal,
`executeImmediate` that runs a command WITHOUT touching the pending
context and recomputes eligibility after, reduced during-accept menus on
active presentations, the doc-line "keeps waiting" affordance, and the
`.pbui-passthru` class), then applied to the demos (commit 46610ca).

Both PORTING-GAPS that motivated this ticket are now closed and
e2e-proven:

- **E-commerce:** VIEW tabs are `active`, the four navigation commands
  are `duringAccept: true`. The New Order e2e now asserts the inverse of
  its old assertion — zero inert tabs — then switches to the Customers
  tab mid-accept, confirms `Accept CUSTOMER` survived, and supplies the
  customer from the newly opened tab.
- **Schema:** instances/wires/pins are `fallthrough`. The new e2e starts
  Draw Instance → CAP, asserts an instance body carries `pbui-passthru`,
  clicks dead-center ON that instance, and the component places at that
  point — the original SPres behavior restored. The pin→location
  coercion stays as UX (pins remain eligible, so wire endpoints still
  snap to pins).

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Commit (code):** 00774ff (core, shared with 004-A4) and 46610ca
(application).

### What worked

- The gating-matrix test file (8 cases) wrote itself from the design's
  §5.1 table; all passed first run after the engine edits.
- The e2e suite caught a self-inflicted regression before it shipped:
  relabeling the menu footer "Dismiss" broke three exact-content
  assertions instantly (decision D5 earning its keep).

### What was tricky to build

- `fallthrough` turned out to be pure CSS (`pointer-events: none`
  without the inert dimming) — the DOM does the fall-through natively,
  no handler changes needed. The subtle part was flag precedence in the
  hook: eligible presentations behave normally in every mode.
- `executeImmediate` must recompute the eligible set after the command
  runs (its effects may change `where` results — switching tabs mounts
  new presentations), but only if a context is still pending.

### What warrants a second pair of eyes

- Reduced menus on active presentations show only duringAccept commands;
  if none apply the menu renders "(no applicable commands)" + Abort —
  check that reads OK in practice.
- Design doc §5.4's open question (does fallthrough suppress hover?):
  resolved as yes — passthru elements get no pointer events at all, so
  no doc-line claims. The crosshair no longer freezes over instances.

### Code review instructions

- `modes.test.ts` is the spec; then the two demo diffs and their e2e
  extensions. Full suite: 53 core + 19 RTL + 26 e2e + perf, all green.

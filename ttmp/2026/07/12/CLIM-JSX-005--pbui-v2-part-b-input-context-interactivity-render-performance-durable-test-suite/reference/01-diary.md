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

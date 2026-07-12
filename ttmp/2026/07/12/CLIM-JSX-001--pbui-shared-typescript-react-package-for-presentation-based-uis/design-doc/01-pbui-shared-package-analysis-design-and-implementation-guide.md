---
Title: 'PBUI shared package: analysis, design, and implementation guide'
Ticket: CLIM-JSX-001
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
    - Path: repo://sources/care-examiner.jsx
      Note: Component-based Pres/Ctx wrapper, command api/world facade, accept loop
    - Path: repo://sources/dynamic-windows-scheduler.jsx
      Note: Most sophisticated presentation model (type lattice, partial commands, live output records)
    - Path: repo://sources/repl-ide(2).jsx
      Note: Listener/transcript evolution, CodeEditor, typed multi-view widgets
    - Path: repo://sources/wip-lisp-machine.jsx
      Note: Universal Pres wrapper, effect-stream redisplay, mouse-doc line
    - Path: repo://ttmp/2026/07/12/CLIM-JSX-001--pbui-shared-typescript-react-package-for-presentation-based-uis/sources/aitr-794.md
      Note: Original 1984 PBUI thesis grounding the theory chapter
ExternalSources: []
Summary: "Full analysis of the 12 CLIM-style JSX prototypes in sources/ plus Ciccarelli's AITR-794 thesis, and the design of @pbui, a shared TypeScript React package family for presentation-based UIs: headless core (ptype lattice, presentation registry, command tables, accept loop), React bindings, listener/chrome components, and a Genera theme."
LastUpdated: 2026-07-12T17:08:59.574077435-04:00
WhatFor: "Onboarding and implementation guide for building the shared PBUI package."
WhenToUse: "Read before implementing or extending @pbui, or when porting one of the sources/ prototypes onto it."
---

# PBUI shared package: analysis, design, and implementation guide

*Audience: a new intern joining the project. No prior knowledge of CLIM, Genera,
or the prototypes is assumed. Everything you need is either explained here or
pointed to by file and line number.*

## 1. Executive summary

This repository contains twelve single-file React prototypes (in `sources/`,
~12,200 lines total) that each re-implement, by hand, the same interaction
paradigm: the **presentation-based UI** (PBUI), as invented in Eugene
Ciccarelli's 1984 MIT thesis (AITR-794) and popularized by Symbolics Genera's
*Dynamic Windows* and later CLIM (the Common Lisp Interface Manager). In a
PBUI, every object drawn on screen remains a live, *typed* handle to the
underlying domain object: you can hover it (and a documentation line tells you
what it is and what the mouse buttons will do), right-click it (and get a menu
of exactly the commands that apply to its type), and click it to supply it as
a typed argument to a partially entered command.

The analysis (Section 4) shows that at least six of the prototypes contain a
near-identical, independently re-typed implementation of the same machinery —
an accept-loop state machine, a command table with typed argument specs, a
presentation wrapper, a mouse-doc line, a context menu, a listener pane, and a
monochrome "Genera" theme. The prototypes disagree only in secondary choices
(wrapper component vs. prop factory, string types vs. a type lattice, plain
text output vs. presentation-bearing output), and the later files consistently
converge on the richer option.

The proposal (Sections 6–9) is a small monorepo of TypeScript packages,
collectively called **`@pbui`**:

- **`@pbui/core`** — framework-free: presentation-type lattice, presentation
  records and registry (the thesis's "presentation data base"), command
  tables, the input-context (accept-loop) state machine, translators, output
  records, and pure derivations (pointer doc, menu contents).
- **`@pbui/react`** — React bindings: `PbuiProvider`, `usePresentation`,
  `<Presentation>` (HTML), `<SvgPresentation>` (SVG), a hit-record adapter
  for canvas, `useInputContext`, `useAccept` (promise facade).
- **`@pbui/listener`** — the interactor: transcript with presentation-bearing
  output records, prompt line, ghost input, command-line parsing with prefix
  match and completion.
- **`@pbui/chrome`** — context menus, mouse-doc bar, status line, pane
  frames, optional window manager.
- **`@pbui/theme-genera`** — the shared monochrome look as CSS custom
  properties and classes (marching-ants accepting outlines, hard shadows,
  inverse video, reduced-motion handling).

Implementation is phased (Section 9) so that after Phase 2 one prototype
(`care-examiner`) can be ported as the proving ground, and each later phase
absorbs one more prototype family.

## 2. Problem statement and scope

### 2.1 Problem

Each new PBUI prototype costs ~800–1,600 lines, of which roughly half is
re-implementation of paradigm machinery rather than domain logic. Concretely,
the accept-loop state machine (`advance` / `startCommand` / `supplyArg` /
`abort`) exists in near-identical form in at least six files
(`care-examiner.jsx:330-353`, `dynamic-windows-scheduler.jsx:127-157`,
`design-kit.jsx:725-763`, `schema-schematic-editor.jsx:786-825`,
`presentation-metrics.jsx:338-378`, `presentation-metrics(2).jsx:1226-1271`).
The same is true of the context-menu chrome, the Escape-aborts key handler,
the mouse-doc bar, the listener discipline, and the monochrome theme (see the
duplication inventory in Section 4.4). Bugs fixed in one prototype do not
propagate; features (like a real type lattice, or presentation-bearing output)
appear in one file and regress in the next.

### 2.2 Goal

Design one shared, typed, tested package family such that a new PBUI app is:

1. a domain model (plain TypeScript state),
2. a set of presentation-type definitions,
3. a command table,
4. presenters (React components that render objects wrapped in
   `<Presentation>`),

with everything else — sensitivity, highlighting, accepting states, menus,
the listener, the mouse-doc line, theming — coming from the package.

### 2.3 Scope

**In scope:** the library design, its public API, package layout, phased
implementation plan, test strategy, and porting guidance for the existing
prototypes. **Out of scope for this document:** actually implementing the
packages; visual redesign of the Genera aesthetic; server/backend integration
(the `repl-ide` mock backend stays app-level); persistence/undo frameworks
(noted as open questions).

## 3. Background: what a presentation-based UI is

You need three layers of history to read the prototypes fluently. Terms
defined here are used without further explanation for the rest of the
document.

### 3.1 The original model (Ciccarelli, AITR-794, 1984)

The thesis (a full transcription is at `<ticket>/sources/aitr-794.md`) models
any interface as a **presentation system** made of two databases and three
processes (aitr-794.md:405-407):

```
             queries/observables                 continual display
+---------------------+        +----------------------+        +--------+
|  APPLICATION  DATA  | -----> |  PRESENTATION  DATA  | -----> | SCREEN |
|  BASE (the domain)  |  P     |  BASE (typed, sym-   |  gfx   | pixels |
|                     | <----- |  bolic screen desc.) | <----- |        |
+---------------------+   R    +----------------------+  edit  +--------+
        commands                      presentations          user gestures

P = presenter   (derives presentations from domain state)
R = recognizer  (translates the user's EDITS of presentations back
                 into domain commands)
```

Key vocabulary, as the thesis defines it:

- A **presentation** is "a visible text or graphic form conveying
  information" (aitr-794.md:78) — a symbolic object, not pixels — that
  records which **presented domain object (pdo)** it shows and which
  **style** was used (aitr-794.md:1515-1517).
- The **presentation data base (PDB)** is "the symbolic screen description
  containing presentations" (aitr-794.md:80). It is first-class and
  queryable: recognizers pattern-match over it, hover/doc facilities inspect
  it, and redisplay diffs it (with per-presentation timestamps and dirty
  propagation — a 1984 virtual DOM, aitr-794.md:1578-1581).
- The **presenter** splits into a *domain collector* (queries the domain),
  a *semantic presenter* (maps domain info to visual forms — "the kind of
  mapping specified by a map legend"), and a domain-independent
  *organizational presenter* (layout) (aitr-794.md:695-721).
- The **recognizer** splits symmetrically into *organizational recognizer*
  (generalized parsing of forms and edit actions), *semantic recognizer*, and
  *domain changer* (aitr-794.md:741-747). Crucially it maps **editing
  actions**, not just visible results, to commands (aitr-794.md:405, 858).
- The **round-trip invariant**: `C * P == P * R(C)` — user edits, once
  recognized and re-presented, must land where the user put them, modulo
  **recognizer tolerance** (the recognizer accepts "12", "12.0", "12.000"
  where the presenter always emits "12.0") (aitr-794.md:856-880).
- **Commands are data**: typed parameter descriptions, command sets, and
  *command applications* with execution state (pending/executing/completed)
  that are themselves presentable objects (aitr-794.md:1537-1545).

Twelve principles a library must preserve to legitimately call itself
"presentation based" are distilled in the thesis analysis; the four
load-bearing ones for us: (1) presentations are **both output and input**;
(2) the PDB is **first-class queryable state that outlives the render pass**;
(3) the **semantic object is separate from its presentations**, so one object
can be presented many ways and styles are swappable at runtime
(aitr-794.md:2721); (4) **multiple simultaneous presentations of one object
stay consistent** (aitr-794.md:1780).

### 3.2 The CLIM/Genera vocabulary (what the prototypes actually mimic)

CLIM and Genera Dynamic Windows made the input side central. The terms the
prototypes use:

- **Presentation type (ptype)** — a named type with supertypes, forming a
  lattice; e.g. `MILESTONE ⊂ TASK ⊂ OBJECT`
  (`dynamic-windows-scheduler.jsx:44-50`).
- **`present`** — render an object as a presentation of some ptype.
- **`accept`** — request an object of a ptype from the user. While an accept
  is pending, an **input context** is active: presentations whose ptype
  matches become *sensitive* (highlighted, clickable); everything else is
  inert. Keyboard entry with a per-type parser is an equivalent supply path.
- **Command table** — commands declare typed arguments; invoking a command
  with missing arguments runs successive `accept`s (the **accept loop**).
- **Presentation translator** — a rule mapping (gesture on a presentation of
  type X, in context Y) to a command or to an argument supply; the
  right-click menu is "all applicable translators/commands", and menu items
  can start a **partial command** with the clicked object pre-bound as the
  first argument.
- **Pointer/mouse-doc line** — a one-line bar at screen bottom continuously
  describing what the mouse buttons would do to the presentation under the
  pointer, given the current input context.
- **Output records** — everything printed to the listener is recorded
  structurally, so objects mentioned in output remain live presentations
  forever ("Names printed here stay mouse-sensitive forever",
  `dynamic-windows-scheduler.jsx:103`).

### 3.3 How the two models line up in React

The thesis→CLIM→React mapping we adopt (full table in the analysis; the
essentials):

| Thesis concept | CLIM concept | @pbui counterpart |
|---|---|---|
| Presentation (form + pdo + style) | Presentation output record | `PresentationRecord` registered by `<Presentation>` |
| Presentation data base | Output-record history | `PresentationRegistry` (store, outlives render) |
| Class network, most-specific style | ptype lattice, `present` methods | `definePresentationType` + presenter registry |
| Recognizer (edit actions → commands) | Presentation translators | Translator rules + gesture router (structural recognizers deferred) |
| Typed argument selection | Input context / `accept` | `InputContext` FSM + `useAccept` |
| Command application w/ state | Command loop | `CommandInvocation` objects (presentable) |
| Graphics redisplay w/ timestamps | Incremental redisplay | React reconciliation (free — do not rebuild) |
| Mouse-tracking reference + doc line | Pointer documentation | Hover manager + `describe` registry + `<MouseDocBar>` |

One point deserves emphasis for newcomers: **React's virtual DOM is not the
presentation data base.** React gives us cheap redisplay, but its tree is
ephemeral and un-queryable at the semantic level. The registry — "which
presentations of which objects with which ptypes are on screen right now,
and where" — must be our own store (Decision D2).

## 4. Current-state analysis of the prototypes

All twelve files live in `sources/`. Sixteen files were imported from
`~/Downloads`; four were byte-identical browser re-downloads and were
deleted (`presentation-metrics(4)`, `repl-ide(1)`, `care-examiner(1)`,
`dynamic-windows-scheduler(1)` — md5-verified).

### 4.1 Corpus overview

| File | Lines | What it is | PBUI depth |
|---|---|---|---|
| `presentation-metrics(1).jsx` | 678 | Metrics + rule network, "PRESENTATION SYSTEM" | Full: Presentation component + promise-based accept |
| `presentation-metrics.jsx` | 910 | "PRESENTA — Metrics II", 18-gauge telemetry | Full: declarative command table + FSM |
| `presentation-metrics(3).jsx` | 1212 | Metrics II + 3D wireframe canvas engine | Full: canvas presentations via hit records |
| `presentation-metrics(2).jsx` | 1619 | "v3": task dispatch + window manager | Full: richest command objects, WM |
| `care-examiner.jsx` | 784 | Multiprocessor-simulator console | Full: Pres/Ctx component, api/world facade |
| `dynamic-windows-scheduler.jsx` | 780 | Gantt scheduler (STS-31) | Full: type lattice, live output records |
| `design-kit.jsx` | 1261 | Control-graph editor + live simulation | Full: dependent arg specs, drag+click gestures |
| `schema-schematic-editor.jsx` | 1101 | Schematic capture + toy SPICE | Full: Pres/SPres duo, presentation-bearing transcript |
| `wip-lisp-machine.jsx` | 836 | WIP presentation-planner demo, real mini-Lisp | Partial: presentations + menus, fixed commands |
| `repl-ide.jsx` | 1152 | JS notebook REPL (mock go-go-goja API) | Adjacent: typed multi-view widgets, no ptypes |
| `repl-ide(2).jsx` | 1184 | Same, notebook → listener transcript | Adjacent |
| `bayes-layer-analysis.jsx` | 680 | Static "Swiss layout" verdict document | None: block-registry renderer only |

The last three still matter: the `repl-ide` pair contributes the listener
UX and the typed multi-view output widget (`{type, summary, views:
[{viewType, label, data}]}`, `repl-ide.jsx:300`), and `bayes-layer-analysis`
demonstrates the data-driven renderer registry (`REGISTRY[b.type]`,
`bayes-layer-analysis.jsx:652-675`) that the presenter registry generalizes.

### 4.2 The four families, briefly

**REPL/lisp-machine family.** `repl-ide.jsx` → `repl-ide(2).jsx` evolves a
Mathematica-style notebook into a CLIM listener: prompt-glyph echo, Enter
submits, autoscrolling transcript, diagnostics collapsed behind a disclosure
(`repl-ide(2).jsx:835-873, 1153-1179`). `wip-lisp-machine.jsx` has the
cleanest universal presentation wrapper (`Pres`,
`wip-lisp-machine.jsx:686-699`), a record-then-replay effect stream driving
incremental redisplay (`wip-lisp-machine.jsx:293-318, 426-443`), and
cross-pane semantic highlighting ("light every presentation of this object",
`wip-lisp-machine.jsx:478-482`).

**Metrics family (four revisions).** Likely order: `(1)` → base → `(3)` →
`(2)`. `(1)` proves the interaction model with the least machinery, including
the elegant abandoned road: promise-based `prompt(type)` awaited inside async
command bodies (`presentation-metrics(1).jsx:176-196`). The base file makes
commands *data* (`COMMANDS` with typed arg specs,
`presentation-metrics.jsx:56-120`) and introduces the explicit accepting FSM.
`(3)` proves presentations don't need DOM: a canvas renderer emits hit
records (`{x, y, gaugeId}`) that the input layer hit-tests
(`presentation-metrics(3).jsx:215-222, 892-901`). `(2)` is the terminal
state: command objects with `appliesTo` predicates, `coerceFirst`
translators, per-type default gestures (`dflt`), menu-valued arguments, inert
dimming of non-matching presentations, and a window manager whose windows are
themselves presentations (`presentation-metrics(2).jsx:932-1202, 608-639`).

**Analysis-app family.** `care-examiner.jsx` contributes the cleanest
separation of concerns: a `Pres` component reading a 6-method context
(`care-examiner.jsx:70-106`), and commands that only see an injected
`{print, world}` capability facade (`care-examiner.jsx:306-322`) — never
React state. `dynamic-windows-scheduler.jsx` is the most CLIM-faithful: a
real ptype lattice with `typep` subtype walking
(`dynamic-windows-scheduler.jsx:44-50`), partial commands seeded from menu
items, `distinct` argument constraints, id-based presentation references with
explicit stale-presentation handling ("A participant vanished — presentation
was stale", `dynamic-windows-scheduler.jsx:245`), and output records as part
arrays (`S/B/TASKREF`) whose task references stay live forever
(`dynamic-windows-scheduler.jsx:88-91, 620-634`).

**Editor family.** `design-kit.jsx` adds the richest argument specs:
dependent options (`options: (argsSoFar) => ...`,
`design-kit.jsx:253`), computed CLIM-style defaults (`argDefault`,
`design-kit.jsx:520-547`), direction-parameterized port types, and
click-vs-drag disambiguation with default gestures
(`design-kit.jsx:862-892`). `schema-schematic-editor.jsx` reifies the
presentation protocol as a **pair** of components — `Pres` (HTML) and
`SPres` (SVG) — sharing one context (`schema-schematic-editor.jsx:275-361`),
treats *commands themselves* as presentations
(`schema-schematic-editor.jsx:1029-1036`), and keeps a presentation-bearing
transcript where line parts like `{pres: "node", name}` re-resolve against
current state at render time (`schema-schematic-editor.jsx:954-962`).

### 4.3 What converged (the de facto standard)

Independently, the mature prototypes agree on:

1. **The accept-loop FSM.** State `{cmd, specs, values}`; `advance` finds the
   next unfilled arg, prompts, and executes when full; `startCommand`
   pre-seeds arg 0 from the invoking presentation; `supplyArg` echoes and
   recurses; Escape (and right-click, in some) aborts with `[Abort]`.
2. **Command tables** of `{name, args: [{name, type, ...}], run}` with menu
   applicability derived from the first argument's type.
3. **Presentation gesture protocol**: mouse-enter/leave set hover + doc;
   left click supplies-if-eligible else default action; middle click
   describes; right click menus (or aborts during accept).
4. **Sensitivity visuals**: hover = solid outline; acceptable = dashed
   marching-ants outline; non-matching during accept = dimmed and/or
   `pointer-events: none`.
5. **Chrome**: inverse-video mouse-doc bar; status line with input-state
   ("User Input" / "Accept TASK"); viewport-clamped hard-shadow context menu
   with type-lattice title and Abort footer; blinking block cursor.
6. **Listener discipline**: typed lines (`out|echo|err`), `Command: ...`
   echo before execution, capped scrollback, autoscroll effect.
7. **Theme**: ink-on-paper monochrome, monospace, hard offset shadows,
   `prefers-reduced-motion` opt-outs — in every single file.

### 4.4 What diverged (choices the package must make)

| Concern | Option A (files) | Option B (files) | Resolution |
|---|---|---|---|
| Attaching presentations | Wrapper component reading context (`care-examiner`, `schema`, `metrics(1)/(2)`) | Prop factory spread onto any element (`scheduler`, `metrics` base/(3)) | Both, over one headless hook (D3) |
| Type matching | Exact string or `any` wildcard (most) | Parent-chain lattice (`scheduler:44-50`) | Lattice + coercions (D4) |
| Presentation payload | Live object refs (`metrics` base) | Ids re-resolved at gesture time (`scheduler`, `metrics(2)`) | Ids/refs + resolver (D5) |
| Accept API | FSM calls (`most`) | Promise `await prompt(type)` (`metrics(1)`) | FSM core + promise facade (D6) |
| Listener output | Plain text lines (`design-kit`, `metrics(2)`) | Part arrays with live presentations (`scheduler`, `schema`, `metrics(1)`) | Parts, always (D7) |
| Mouse-doc | Pull: pure function of (accept, hover) (`care-examiner:426-435`, `design-kit:929-958`) | Push: `setDoc` from handlers (`schema:299-307`) | Pull (D8) |
| Sensitivity computation | Centralized render-time flags (`design-kit:838-843`) | Decentralized: each presentation self-derives from context (`schema:284-361`) | Decentralized (D3) |
| Non-DOM renderers | n/a | Canvas hit records (`metrics(3):892-901`) | First-class adapter (D3) |

### 4.5 Gap analysis against the thesis

Even the best prototypes stop short of the 1984 model in four places, which
the package should treat as designed-for extension points rather than
immediate features:

1. **No queryable PDB.** Hover/menu logic works because handlers close over
   the right object, but nothing can ask "what presentations of task-7 are on
   screen?" — which is exactly what cross-pane highlighting hand-rolls in
   `wip-lisp-machine.jsx:478-482`. The registry (D2) fixes this.
2. **No structural recognizers.** All input is gesture-per-presentation;
   nobody parses *arrangements* or *edit histories* (thesis Chapter 5's
   curve/move/annotation recognizers). We keep an edit-history hook in the
   registry design but defer recognizers (Section 12).
3. **No round-trip codecs.** Keyboard supply paths hand-roll per-type parsers
   (`design-kit.jsx:793-820`, `schema:827-836`); nothing pairs them with the
   printers to test `parse(render(x)) ≡ x`. The ptype record carries both
   (D4), making the invariant testable.
4. **No plans/command-databases.** Commands execute immediately everywhere.
   `CommandInvocation` objects (Section 6.5) leave room for pending/staged
   execution later, as the thesis's planned-database extension suggests.

## 5. Requirements

Functional (derived from the corpus; each traces to evidence above):

- R1. Define ptypes with supertypes, parameters, a printer, a parser, a
  describer, and a default-gesture command.
- R2. Register presentations of (ref, ptype) from HTML, SVG, and non-DOM
  renderers; query them by object, by ptype, by screen point.
- R3. Command tables with typed args (presentation / typed-input / menu
  choice), applicability predicates, coercions, defaults, dependent options,
  `distinct` constraints, and partial invocation with pre-seeded args.
- R4. Accept-loop engine with Escape/right-click abort, eligible/inert
  partitioning, keyboard supply via ptype parsers, prompt rendering, and a
  promise facade.
- R5. Listener with part-structured output records whose object parts remain
  live presentations; echo/prompt grammar; command line with prefix match,
  ambiguity report, and Tab completion.
- R6. Chrome: mouse-doc bar, status/mode line, context menus, pane frames;
  optional window manager.
- R7. Theme package reproducing the Genera look, tokenized; reduced-motion
  respected.

Non-functional: TypeScript strict; zero runtime deps besides React (core has
none at all); tree-shakeable; every state machine testable without DOM;
Storybook stories per component (the repo's `react-modular-themable-storybook`
conventions apply when we get to implementation).

## 6. Proposed architecture

### 6.1 Package layout

```
packages/
  core/          @pbui/core          no deps, no React
    src/
      ptype.ts             definePresentationType, lattice, matches, coerce
      presentation.ts      PresentationRecord, refs, resolver protocol
      registry.ts          PresentationRegistry (the PDB) + queries + events
      command.ts           defineCommand, CommandTable, applicability
      input-context.ts     InputContext FSM (advance/start/supply/abort)
      invocation.ts        CommandInvocation objects + echo grammar
      output.ts            OutputRecord parts model (S/B/objectRef/...)
      docline.ts           pointerDoc(state) and mode(state) derivations
      menu.ts              menuFor(presentation|global, state) derivation
      parse.ts             command-line prefix match, completion, arg parsing
  react/         @pbui/react         deps: react, @pbui/core
    src/
      provider.tsx         PbuiProvider (engine + registry in context)
      use-presentation.ts  headless hook -> props + state flags
      presentation.tsx     <Presentation> (HTML), <SvgPresentation> (SVG)
      hit-layer.ts         canvas/imperative adapter (hit records)
      use-input-context.ts subscribe to accept state
      use-accept.ts        promise facade
      use-related.ts       useRelatedPresentations(ref)
  listener/      @pbui/listener      deps: react, @pbui/core, @pbui/react
    src/
      listener.tsx         transcript + prompt + ghost input
      parts.tsx            part renderers (text, bold, presentation, ...)
      code-editor.tsx      overlay-highlighted textarea (from repl-ide(2))
  chrome/        @pbui/chrome        deps: react, @pbui/core, @pbui/react
    src/
      menu.tsx             <ContextMenu> incl. choice-menu mode
      mouse-doc.tsx        <MouseDocBar>, <StatusLine>
      pane.tsx             <Pane> frame with label bar
      windows.tsx          optional desktop WM (from metrics(2))
  theme-genera/  @pbui/theme-genera  CSS only (+ ts token map)
    src/
      tokens.css           --pbui-ink, --pbui-paper, accents, fonts
      states.css           .pbui-hover, .pbui-eligible (ants), .pbui-inert
      chrome.css           menus, doc bar, status, panes, scrollbars
apps/            ported prototypes, one per directory (Phase 4+)
```

Dependency rule: `core` imports nothing; `react` imports `core`;
`listener`/`chrome` import both; themes import nothing. Apps compose.

### 6.2 Core model: ptypes

```ts
// @pbui/core/ptype.ts
export interface PTypeSpec<T = unknown> {
  name: string;                       // "task", "milestone", "number"
  supertypes?: string[];              // ["task"]  — lattice edges
  parameters?: Record<string, unknown>; // e.g. { dir: "in" } for ports
  print: (obj: T, ctx: PrintCtx) => string;      // "#<TASK T-3 ...>"
  describe?: (obj: T, ctx: DescribeCtx) => OutputPart[];
  parse?: (text: string, world: unknown) => ParseResult<T>;
  // parse is the keyboard half of accept; print/parse form the
  // round-trip codec (thesis invariant, aitr-794.md:856-880)
  defaultCommand?: string;            // left-click translator ("dflt")
}
export function definePresentationType<T>(spec: PTypeSpec<T>): PType<T>;

// lattice queries
export function subtypep(lattice: Lattice, t: string, want: string): boolean;
export function latticePath(lattice: Lattice, t: string): string[];
// -> ["milestone","task","object"], printed "MILESTONE ⊂ TASK ⊂ OBJECT"
```

Matching generalizes the corpus: `matches(spec, pres)` is `spec.type ===
"any" || subtypep(pres.type, spec.type)`, then parameter predicates (the
`dir` check from `design-kit.jsx:845-850` becomes a parameter matcher), then
optional coercion (`coerceFirst` from `presentation-metrics(2).jsx:983`
becomes a registered translator, Section 6.6).

### 6.3 Presentations and the registry (the PDB)

A presentation record is small and reference-holding — the scheduler's
discipline, which survived world garbage collection gracefully:

```ts
export interface PresentationRecord {
  id: PresId;                 // registry-assigned
  type: string;               // ptype name
  ref: ObjectRef;             // { kind: "task", id: "T-3" } — NOT the object
  label: string;              // display label for echo/menus/doc line
  paneId?: string;
  parentId?: PresId;          // composition (thesis composites)
  bounds?: () => Rect | null; // lazily measured; hit layer supplies its own
}

export interface Resolver {
  resolve(ref: ObjectRef): unknown | undefined;  // undefined = stale
}
```

The registry is the thesis's presentation data base: a store that presenters
write (on mount/update/unmount) and everything else queries:

```ts
export interface PresentationRegistry {
  register(rec: Omit<PresentationRecord, "id">): PresId;
  update(id: PresId, patch: Partial<PresentationRecord>): void;
  unregister(id: PresId): void;
  byRef(ref: ObjectRef): PresentationRecord[];   // cross-pane highlighting
  byType(want: string): PresentationRecord[];    // eligible sets
  at(x: number, y: number): PresentationRecord | undefined; // smallest wins
  subscribe(fn: (ev: RegistryEvent) => void): Unsubscribe;
}
```

React components register via `usePresentation` (Section 6.7); the canvas
adapter registers hit records each frame (Section 6.8). Two consumers ship in
v1: `useRelatedPresentations(ref)` (generalizing
`wip-lisp-machine.jsx:478-482`) and the eligible/inert partition during
accepts. Structural recognizers are the deferred third consumer.

### 6.4 Command tables

The converged shape is `presentation-metrics(2)`'s command object, enriched
with `design-kit`'s argument features:

```ts
export interface ArgSpec {
  name: string;
  type: string;                        // ptype name; "number"/"string"/enums included
  input?: "presentation" | "typed" | "menu";   // default "presentation"
  prompt?: string;
  options?: (soFar: ArgValues, world: unknown) => Choice[];  // dependent (design-kit:253)
  default?: (soFar: ArgValues, world: unknown) => unknown;   // CLIM [default ...]
  distinct?: boolean;                  // != earlier args (scheduler:296)
  validate?: (v: unknown, soFar: ArgValues) => true | string;
}

export interface CommandSpec<W> {
  name: string;                        // "Move Task"
  doc?: string;
  args: ArgSpec[];
  appliesTo?: (pres: PresentationRecord, world: W) => boolean; // state-sensitive menus
  isDefaultFor?: string[];             // ptypes this is the L-click default of
  global?: boolean;                    // background-menu / command-line only
  run: (values: ArgValues, api: CommandApi<W>) => void | Promise<void>;
}

export interface CommandApi<W> {
  print: (...parts: OutputPart[]) => void;   // listener output
  world: W;                                  // injected capability facade
  accept: <T>(spec: ArgSpec) => Promise<T | null>;  // mid-body accepts
  invoke: (name: string, preset?: ArgValues) => void; // chaining (schema:694)
}
```

Commands never touch React or the registry directly — the `care-examiner`
capability-facade rule (`care-examiner.jsx:306-322`), which is what makes the
whole command layer unit-testable in Node.

Menu derivation is a pure function: object menu = commands whose first arg
matches the presentation (after coercion) and whose `appliesTo` passes;
global menu = `global` commands; items whose arg list is not fully satisfied
render with a trailing "…" and start partial commands.

### 6.5 The input context (accept loop)

One small FSM, finally written once:

```
        startCommand(cmd, seedPres?)
                 |
                 v
     +------ advance(cmd, values) ------+
     |  all args filled?                |
     | yes                              | no
     v                                  v
 runCommand ----> echo + run()    accepting = {cmd, values, spec}
 (invocation                            |
  recorded)          +------------------+--------------------+
                     |                  |                     |
              click eligible      typed input           menu choice
              presentation        (ptype.parse,         (spec.options,
              (supplyArg)          validate)             at pointer pos)
                     |                  |                     |
                     +---------> echo value, recurse advance |
                                        ^                     |
                                        +---------------------+
          Escape / right-click / [Abort] item --> abort() --> echo "[Abort]"
```

State and transitions in TypeScript:

```ts
export interface AcceptState {
  cmd: CommandSpec<any>;
  values: ArgValues;                 // filled so far (arg 0 often pre-seeded)
  spec: ArgSpec;                     // currently wanted
  pointer: { x: number; y: number }; // for menu-valued args (metrics(2):1218)
}

export interface InputContextEngine {
  state(): AcceptState | null;
  start(cmd: CommandSpec<any>, seed?: PresentationRecord): void;
  supply(pres: PresentationRecord): void;   // validates matches + distinct
  supplyParsed(text: string): void;         // keyboard path via ptype.parse
  abort(): void;
  eligible(pres: PresentationRecord): boolean;
  subscribe(fn: () => void): Unsubscribe;
}

// promise facade, restoring metrics(1)'s ergonomics on top of the FSM:
// const site = await accept<Site>({ name: "site", type: "site" });
```

The engine also owns the echo grammar, standardized from the corpus:

```
Command: Move Task (task) FLIGHT-READINESS      ; start w/ seeded arg
  to-month (a MONTH) ⇒ AUG 1988                 ; each supplied arg
[Abort]                                          ; on abort
```

### 6.6 Translators

Three translator kinds cover everything the corpus does:

1. **Menu translators** — implicit: applicable commands become menu items;
   clicking one starts a partial command with the presentation as arg 0
   (every mature file).
2. **Default-gesture translators** — `isDefaultFor` picks the left-click
   command per ptype, first-match ordered (`presentation-metrics(2).jsx:965,
   1286-1290`).
3. **Coercions** — `defineCoercion(fromPtype, toPtype, fn)`: lets a `panel`
   presentation satisfy an `events` argument
   (`presentation-metrics(2).jsx:983`). Applied during `matches` and during
   menu derivation.

Drag-and-drop translators (thesis move-recognition rules,
aitr-794.md:1997-2011; click-vs-drag disambiguation in
`design-kit.jsx:862-892`) are specified but scheduled for Phase 5.

### 6.7 React bindings

The headless hook is the primitive; both wrapper components and prop-spreads
are thin layers over it (resolving the corpus's A/B split):

```tsx
export function usePresentation(input: {
  type: string; ref: ObjectRef; label: string;
  parent?: PresId; pane?: string; quiet?: boolean;   // quiet: metrics(3):578
}): {
  props: {   // spread onto any element — HTML, SVG, anything with handlers
    onMouseEnter; onMouseLeave; onClick; onAuxClick; onContextMenu;
    "data-pbui-pres": PresId;
  };
  isHovered: boolean;
  isEligible: boolean;   // matches current accept spec
  isInert: boolean;      // an accept is active and this doesn't match
  presId: PresId;
};

export function Presentation(props: PresProps & { block?: boolean }): JSX;
// renders <span>/<div class="pbui-pres [pbui-hover|pbui-eligible|pbui-inert]">

export function SvgPresentation(props: PresProps & {
  hitRect?: Rect;        // invisible hit target (schema:350-351)
}): JSX;                 // renders <g> + highlight ring rects
```

Gesture routing (one place, finally): left click → `supply` if eligible,
else the ptype's default command, else Describe; middle click (`onAuxClick`)
→ Describe; right click → abort if accepting, else open the command menu;
enter/leave → hover + doc line. This is exactly the protocol every file
hand-wires.

`PbuiProvider` wires it together:

```tsx
<PbuiProvider engine={engine} registry={registry} resolver={resolver}
              commands={commandTable} theme="genera">
  <YourPanes/>
  <Listener/>
  <MouseDocBar/> <StatusLine/>
</PbuiProvider>
```

### 6.8 Non-DOM renderers (canvas / WebGL)

From `presentation-metrics(3)`: an imperative renderer produces, per frame,
a list of hit records; the adapter syncs them into the registry and
hit-tests pointer events on the canvas element:

```ts
export function createHitLayer(canvas: HTMLCanvasElement, opts: {
  toPres: (hit: HitRecord) => Omit<PresentationRecord, "id" | "bounds">;
}): {
  commit(hits: HitRecord[]): void;   // per frame; diffs against previous
  dispose(): void;
};
```

The renderer is also handed the current UI state snapshot (`hovered`,
`eligibleRefs`) so it can paint hover boxes and marching-ants rectangles
itself, as `presentation-metrics(3).jsx:280-308` does.

### 6.9 Output records and the listener

Lines are part arrays — the feature that regressed in the corpus and is
mandatory here (D7):

```ts
export type OutputPart =
  | { t: "text"; s: string }
  | { t: "bold"; s: string }
  | { t: "err";  s: string }
  | { t: "pres"; type: string; ref: ObjectRef; label: string }  // stays live
  | { t: "view"; view: string; data: unknown };  // repl-ide multi-view widgets

export interface OutputRecord { id: string; kind: "out"|"echo"|"err"; parts: OutputPart[]; }
```

`@pbui/listener`'s `<Listener>` renders records (a `pres` part mounts a real
`<Presentation>`, so transcript mentions participate in accepts forever —
`dynamic-windows-scheduler.jsx:103`), keeps a capped autoscrolling
scrollback, renders the prompt line in its three states (idle prompt /
"accepting TYPE — point at a highlighted object" / typed-arg ghost input with
`[default ...]`), and hosts the command line: prefix match, ambiguity report
("`x` is ambiguous: …", `dynamic-windows-scheduler.jsx:397-416`), Tab
completion, and greedy positional-argument parsing (`:Probe Node SOUT 2`,
`schema-schematic-editor.jsx:855-861`).

### 6.10 Chrome and theme

`@pbui/chrome` standardizes the five pieces every file rebuilt: the context
menu (viewport-clamped, hard shadow, lattice-path title, arg-type
annotations, "…" partial-command marker, Abort footer; doubles as the
choice-menu for menu-valued args); the mouse-doc bar (pure derivation:
accepting → "Accepting a SITE — Mouse-L on a blinking presentation supplies
it. [Escape] aborts."; hovering → "`#<TYPE label>` L: <default>; M:
Describe; R: menu of N operations"; idle → app help line); the status line
(clock · user · mode: "User Input" / "Accept TASK"); the `<Pane>` frame; and
the optional window manager from `presentation-metrics(2)` (drag/resize,
z-order raise/bury, `openOrExpose` dedupe, windows-as-presentations).

`@pbui/theme-genera` ships the tokens (`--pbui-ink`, `--pbui-paper`, accent
variables with the "chrome stays monochrome, accents on text only" rule from
`repl-ide.jsx:7-9` and `presentation-metrics(2).jsx:1426-1431`) and the state
classes: `.pbui-hover` (solid outline), `.pbui-eligible` (dashed
marching-ants animation), `.pbui-inert` (dim + `pointer-events: none`),
inverse-video helpers, blink cursor, hard shadows, inverted scrollbars, and
the `prefers-reduced-motion` overrides present in all twelve files.

## 7. Decision records

### Decision D1: Monorepo of small packages, headless core first

- **Context:** One package vs. several; where React stops and logic starts.
- **Options considered:** (a) single `@pbui/react` package; (b) core +
  bindings split; (c) core + bindings + listener/chrome/theme split.
- **Decision:** (c).
- **Rationale:** The corpus proves the logic is framework-independent — the
  same FSM drives DOM, SVG, and canvas presentations
  (`presentation-metrics(3).jsx:930-960`); `care-examiner`'s command layer
  already never touches React. Listener and WM are heavy enough that apps
  not using them shouldn't pay for them.
- **Consequences:** Slightly more repo plumbing; clean unit testing of core
  in Node; future non-React bindings possible.
- **Status:** proposed

### Decision D2: A real PresentationRegistry (the PDB), not just handlers

- **Context:** The prototypes work without a queryable registry; the thesis
  says the PDB is the heart of the model (aitr-794.md:80, principle 2).
- **Options considered:** (a) no registry — context callbacks only, as in
  most prototypes; (b) registry as an internal detail; (c) registry as a
  public, subscribable store.
- **Decision:** (c).
- **Rationale:** Three shipped features already need it: cross-pane
  highlight-all-presentations-of-object (`wip-lisp-machine.jsx:478-482`),
  eligible/inert partitioning without prop drilling, and canvas hit layers.
  It is also the extension point for structural recognizers and for
  debugging tools ("show me everything presenting task-7").
- **Consequences:** Mount/unmount registration cost per presentation
  (bounded: one map insert); must document that `bounds` is lazy to avoid
  layout thrash.
- **Status:** proposed

### Decision D3: Headless `usePresentation` hook; wrappers are sugar

- **Context:** Wrapper-component vs. prop-factory split in the corpus (§4.4).
- **Options considered:** (a) wrapper components only; (b) prop factory
  only; (c) hook returning props + state, with `<Presentation>` and
  `<SvgPresentation>` as thin wrappers, plus a hit-record adapter.
- **Decision:** (c).
- **Rationale:** `dynamic-windows-scheduler.jsx:339-350` spreads identical
  props onto SVG groups and text spans; `schema-schematic-editor.jsx:284-361`
  shows HTML and SVG need different highlight rendering; `metrics(3)` shows
  DOM may be absent entirely. Only a headless core serves all three; sugar
  components serve the common case.
- **Consequences:** Two documented API levels; highlight rendering must be
  specified per medium (CSS classes for HTML, ring rects for SVG, painted
  by the renderer for canvas).
- **Status:** proposed

### Decision D4: ptype lattice with codecs, not string equality

- **Context:** Matching evolved string-equality → `any` → lattice (§4.4).
- **Options considered:** (a) flat strings + `any`; (b) parent-chain lattice;
  (c) lattice + parameters + coercions + parse/print codecs.
- **Decision:** (c).
- **Rationale:** The scheduler's lattice (`typep`,
  `dynamic-windows-scheduler.jsx:45`) subsumes the flat scheme;
  `design-kit`'s `dir`-checked ports need parameters; `metrics(2)`'s
  `coerceFirst` needs coercions; every keyboard supply path needs `parse`,
  and pairing it with `print` makes the thesis round-trip invariant
  (aitr-794.md:876-880) a property test instead of folklore.
- **Consequences:** Slightly heavier ptype definitions; TS generics keep
  object types honest; lattice cycles must be rejected at definition time.
- **Status:** proposed

### Decision D5: Presentations hold ObjectRefs resolved through a Resolver

- **Context:** Live object refs go stale under simulation ticks and GC.
- **Options considered:** (a) live references; (b) ids + app-supplied
  resolver; (c) both, with refs normalized to `{kind, id}`.
- **Decision:** (b), with a permissive escape hatch (`kind: "value"` wrapping
  immediates like numbers).
- **Rationale:** `metrics(2)` and the scheduler both adopted id-resolution
  with explicit stale handling ("object vanished" guards,
  `presentation-metrics(2).jsx:1025`; "presentation was stale",
  `dynamic-windows-scheduler.jsx:245`) after earlier variants silently held
  stale objects. The listener transcript makes this unavoidable: parts
  printed minutes ago must re-resolve at render time
  (`schema-schematic-editor.jsx:957`).
- **Consequences:** Apps must provide a `Resolver`; the package must define
  behavior for stale supplies (reject with a listener message, per the
  scheduler).
- **Status:** proposed

### Decision D6: FSM core with a promise facade for accepts

- **Context:** `metrics(1)`'s `await prompt(type)` is the nicest authoring
  experience but was abandoned; the FSM is what everything else uses.
- **Options considered:** (a) FSM only; (b) promises only; (c) FSM as the
  single source of truth, `accept()` promise facade + `CommandApi.accept`
  for mid-body accepts.
- **Decision:** (c).
- **Rationale:** The FSM is inspectable (prompt line, mouse-doc, menus all
  derive from its state) and serializable; promises alone hide state in
  closures. But command bodies like `cmdCompare`
  (`presentation-metrics(1).jsx:260-267`) are dramatically clearer with
  `await`. The facade stores the resolver keyed by the FSM state, exactly as
  `metrics(1)` did with a ref (`presentation-metrics(1).jsx:176-196`).
- **Consequences:** Abort must reject/resolve-null pending promises; command
  bodies may be async — invocation records track completion.
- **Status:** proposed

### Decision D7: Output records are part arrays; object parts stay live

- **Context:** Presentation-bearing transcripts existed in `metrics(1)`, the
  scheduler, and the schema editor, and regressed elsewhere.
- **Options considered:** (a) string lines; (b) parts.
- **Decision:** (b), with `{t:"pres"}` parts mounting real presentations.
- **Rationale:** This is the CLIM behavior that makes the listener a PBUI
  surface at all ("Names printed here stay mouse-sensitive forever",
  `dynamic-windows-scheduler.jsx:103`); its loss in `metrics(2)` was the one
  identified regression in the most mature prototype.
- **Consequences:** `print` takes parts, not strings (string sugar
  provided); scrollback capping must unregister presentations of dropped
  lines.
- **Status:** proposed

### Decision D8: Doc line and menus are pure derivations of engine state

- **Context:** Pull-computed doc lines vs. push `setDoc` from handlers.
- **Options considered:** (a) push; (b) pull.
- **Decision:** (b): `pointerDoc(acceptState, hoverPres, commandTable)` and
  `menuFor(...)` are pure functions in core.
- **Rationale:** The pull versions in `care-examiner.jsx:426-435` and
  `design-kit.jsx:929-958` cannot desynchronize (no stale doc after a
  context ends), are trivially unit-testable, and automatically reflect
  context changes mid-hover. Push versions needed manual fallback recompute
  (`schema-schematic-editor.jsx:945-947`).
- **Consequences:** Presentations only *report* hover; all text derives
  centrally. Apps can still append app-specific doc via a formatter option.
- **Status:** proposed

## 8. Key flows (pseudocode)

### 8.1 Right-click → partial command → click-to-supply → execute

```
user right-clicks the FLIGHT-READINESS milestone presentation
  gestureRouter(contextmenu, pres{type: milestone, ref: task:T-7})
    acceptState == null
    items = menuFor(pres) =
      commands where matches(args[0], pres after coercions)
                 and appliesTo(pres, world)
      -> [Describe, Modify Task, "Slip Milestone …", "Anchor End …", ...]
    <ContextMenu title="MILESTONE ⊂ TASK ⊂ OBJECT  FLIGHT-READINESS">

user picks "Slip Milestone …"
  engine.start(SlipMilestone, seed=pres)
    values = { milestone: ref task:T-7 }        // arg 0 pre-seeded
    echo: "Command: Slip Milestone (milestone) FLIGHT-READINESS"
    spec  = { name: "to-month", type: "month" }
    -> AcceptState active; registry.byType("month") become eligible,
       everything else inert; prompt line: "Slip Milestone
       (milestone: FLIGHT-READINESS) (to-month: █)"

user hovers AUG 1988 header
  docline = pointerDoc(accept, pres) =
    "⟨to-month⟩ of Slip Milestone — L: use AUG 1988   Esc: abort"

user left-clicks AUG 1988
  engine.supply(pres{type: month})
    matches? yes; distinct? n/a; echo "  to-month (a MONTH) ⇒ AUG 1988"
    all args filled -> runCommand:
      invocation = { cmd, values, status: executing }   // presentable
      cmd.run(resolved values, api)
        api.world.slipMilestone(...)                    // mutate domain
        api.print(pres("task", T-7), " slips to ", bold("AUG 1988"))
      invocation.status = completed
    acceptState = null; eligibility clears everywhere
```

### 8.2 Keyboard supply

```
prompt: "  interval (a NUMBER) [default 650] ⇒ "
user types "abc", Enter
  ptypes.number.parse("abc") -> { ok: false, err: "not a valid NUMBER" }
  listener: err "abc is not a valid NUMBER"           // corpus grammar
user presses Enter on empty input
  spec.default(world) -> 650 -> supplyParsed uses it   // design-kit:788-791
```

### 8.3 Canvas frame

```
each animation frame:
  hits = renderScene(ctx, world, uiSnapshot)   // paints + returns hit recs
  hitLayer.commit(hits)                        // diff into registry
on canvas pointer event at (x, y):
  pres = registry.at(x, y)                     // smallest extent wins
  gestureRouter(eventKind, pres)               // same router as DOM
```

## 9. Implementation plan

Phased so every phase ends with something running. File paths refer to the
layout in Section 6.1.

**Phase 0 — Workspace (half a day).** pnpm workspace, TS strict configs,
vitest, Storybook shell in `packages/react`. No code.

**Phase 1 — Core (3–4 days).** `ptype.ts` (lattice + cycle rejection +
matches + coercions), `presentation.ts`, `registry.ts` (map + indices +
subscribe; `at()` by rect area), `command.ts`, `input-context.ts` (FSM +
echo grammar + promise facade), `output.ts`, `docline.ts`, `menu.ts`,
`parse.ts`. Everything unit-tested in Node against a fake world (a trimmed
`care-examiner` domain is a good fixture). Exit criterion: scripted
transcript test — start command, supply via fake presentations and parsed
text, assert echoes, abort mid-way, assert `[Abort]`.

**Phase 2 — React bindings + minimal chrome (3 days).** `provider.tsx`,
`use-presentation.ts`, `presentation.tsx`, `use-input-context.ts`,
`use-accept.ts`, `use-related.ts`; `chrome/menu.tsx`, `chrome/mouse-doc.tsx`;
`theme-genera` tokens + state classes. Storybook: a toy 10-object pane
demonstrating hover/eligible/inert, menus, and a two-argument command.

**Phase 3 — Listener (2–3 days).** `listener.tsx` with parts renderer,
prompt states, ghost input, command-line parse/completion;
`code-editor.tsx` ported from `repl-ide(2).jsx:505-611` (gutter, maxRows,
Enter modes, completion chips).

**Phase 4 — Proving ground: port care-examiner (2–3 days).**
`apps/care-examiner/`: domain sim (~150 lines) + ptypes (site, service,
operator, load-level, metric, restart, number) + command table + panes.
Success = feature parity with `sources/care-examiner.jsx` at well under half
its 784 lines of app code. Every gap found feeds back into core before
Phase 5.

**Phase 5 — SVG + editors (3–4 days).** `SvgPresentation` with hit rects and
ring highlights; ghost/rubber-band preview derived from accept state
(`schema-schematic-editor.jsx:934-943`); click-vs-drag disambiguation and
DnD translators (`design-kit.jsx:862-892`); dependent options and computed
defaults in arg prompting. Port `dynamic-windows-scheduler` (validates
lattice, partial commands, live transcript refs) and optionally
`schema-schematic-editor`.

**Phase 6 — Canvas adapter + WM (2–3 days).** `hit-layer.ts`; port
`presentation-metrics(3)`'s wireframe pane as the demo. `chrome/windows.tsx`
WM from `presentation-metrics(2).jsx:608-639, 827-869`; windows registered
as `panel` presentations with Expose/Bury/Kill/Rename commands.

**Phase 7 — Polish (ongoing).** Formatted-output kit (tables with
presentation cells, sparklines, layered-DAG layout from
`presentation-metrics(2).jsx:455-478`); accepting-values dialog
(`dynamic-windows-scheduler.jsx:709-772`); accessibility pass (focus-visible,
aria labels, keyboard-only accept path); docs site from Storybook.

## 10. Testing and validation strategy

1. **Core unit tests (Node, no DOM).** FSM transition table incl. abort at
   every state; `distinct` and `validate` rejection paths; lattice
   subtyping + coercion resolution order; menu derivation against
   `appliesTo` fixtures; command-line prefix/ambiguity/completion;
   registry index consistency under register/update/unregister churn.
2. **Round-trip property tests.** For every ptype with both `print` and
   `parse`: `parse(print(x)) ≡ x` for generated x, and parser tolerance
   cases ("12", "12.0") normalize to one value — the thesis invariant as CI.
3. **Transcript golden tests.** Scripted interactions produce output-record
   sequences compared against golden files; the echo grammar is the spec.
4. **React Testing Library.** Gesture routing (click/aux/context), eligible
   and inert class application, stale-ref supply rejection, scrollback
   capping unregisters transcript presentations.
5. **Storybook + visual checks.** State-class stories (hover, ants, inert)
   in light of theme tokens; reduced-motion story.
6. **Port parity.** The Phase 4/5 ports are the integration suite: a checklist
   per prototype of behaviors (from Section 4's analyses) that must survive.

## 11. Risks, alternatives, open questions

**Risks.**
- *Registry churn:* simulation ticks re-render many presentations;
  `update()` must be cheap and `bounds` lazy, or the PDB becomes the
  bottleneck. Mitigation: benchmarks in Phase 4 (care-examiner ticks at
  100ms–5s, `care-examiner.jsx:187-194`).
- *Gesture conflicts:* `onAuxClick`/middle-click and context-menu behavior
  vary across browsers/trackpads; the corpus already hedges (advertised but
  unbound middle-click in `wip-lisp-machine.jsx:450`). Mitigation: gesture
  map is configurable; defaults tested on the three major browsers.
- *Scope creep toward full thesis:* structural recognizers, planned
  databases, and phrasal presenters are research-sized. They are explicitly
  deferred; the registry and invocation records are their landing pads.

**Alternatives considered and rejected.**
- *Adopt a state-management library (Redux/zustand) inside core:* rejected;
  core stays dependency-free, apps own their world state and expose it via
  the Resolver/world facade.
- *CSS-in-JS for the theme:* rejected in favor of plain CSS custom
  properties + classes, matching the repo's theming conventions and the
  corpus's convergence on injected stylesheets.
- *One mega-package:* rejected (D1).

**Open questions.**
1. Undo/redo: none of the prototypes has it; invocation records make a
   command-history undo plausible. Decide after Phase 4.
2. Persistence of world + transcript (design-kit prints s-expressions but
   never loads, `design-kit.jsx:695-705`). App concern or package helper?
3. Should the WM live in `@pbui/chrome` or its own package? Decide by size
   after Phase 6.
4. Multi-select / argument-first interaction (thesis argument-first top
   level, aitr-794.md:2065-2073) — no prototype implements it; defer.
5. Naming: `@pbui/*` assumed throughout; confirm npm scope availability
   before Phase 0.

## 12. Deferred thesis features (extension roadmap)

For completeness, the parts of AITR-794 we deliberately postpone, with their
landing pads in this design: structural/curve/annotation recognizers (land
on: registry queries + a future edit-history log); planned databases and
"do it" staging (land on: `CommandInvocation` with `pending` status and a
second store instance); phrasal presenter / natural-language doc lines (land
on: `describe` registry returning parts); presenter-state-as-presentable
("change presentation style" at runtime, aitr-794.md:2721 — land on: style
metadata in the presenter registry).

## 13. References

**Sources analyzed (repo paths).**
- `sources/presentation-metrics(1).jsx`, `sources/presentation-metrics.jsx`,
  `sources/presentation-metrics(3).jsx`, `sources/presentation-metrics(2).jsx`
  — the metrics lineage (§4.2).
- `sources/care-examiner.jsx` — Pres/Ctx wrapper, capability facade.
- `sources/dynamic-windows-scheduler.jsx` — ptype lattice, partial commands,
  live output records.
- `sources/design-kit.jsx` — dependent arg specs, defaults, gestures.
- `sources/schema-schematic-editor.jsx` — Pres/SPres pair, presentation-
  bearing transcript, command-line arg parsing.
- `sources/wip-lisp-machine.jsx` — universal wrapper, effect-stream
  redisplay, cross-pane highlighting.
- `sources/repl-ide.jsx`, `sources/repl-ide(2).jsx` — listener UX, code
  editor, multi-view widgets.
- `sources/bayes-layer-analysis.jsx` — renderer registry, token discipline.

**Primary literature.**
- E. C. Ciccarelli IV, *Presentation Based User Interfaces*, MIT AI Lab
  TR-794, August 1984 — transcription at `<ticket>/sources/aitr-794.md`.

**Ticket documents.**
- Investigation diary: `reference/01-investigation-diary.md` (same ticket) —
  chronological record including the analysis fan-out and verification
  commands.

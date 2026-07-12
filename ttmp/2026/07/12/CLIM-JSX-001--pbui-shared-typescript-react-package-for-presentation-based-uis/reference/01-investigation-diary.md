---
Title: Investigation diary
Ticket: CLIM-JSX-001
Status: active
Topics:
    - pbui
    - react
    - typescript
    - design
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://sources/presentation-metrics(2).jsx
      Note: Most mature variant; evolution endpoint analyzed in step 2
    - Path: repo://ttmp/2026/07/12/CLIM-JSX-001--pbui-shared-typescript-react-package-for-presentation-based-uis/sources/aitr-794.md
      Note: Thesis imported in step 3
ExternalSources: []
Summary: Chronological diary of the PBUI shared-package analysis and design work.
LastUpdated: 2026-07-12T17:08:59.638621397-04:00
WhatFor: Record how the CLIM-JSX-001 investigation unfolded, including failures and verification steps.
WhenToUse: Read before continuing or reviewing the CLIM-JSX-001 work.
---


# Diary

## Goal

Capture the investigation and design journey for CLIM-JSX-001: importing the
JSX presentation-UI prototypes from `~/Downloads`, deduplicating them,
analyzing all twelve survivors, and designing a shared TypeScript React
package for presentation-based UIs (PBUI), delivered as an intern-level
implementation guide and uploaded to reMarkable.

## Step 1: Import sources, deduplicate, create ticket

The repository was an empty git init with only an initial commit. The first
move was to bring the raw material in: sixteen `.jsx` files from
`~/Downloads`, several of which were browser-download duplicates (`(1)`,
`(4)` suffixes). Copying them into `sources/` and checksumming immediately
told us which "variants" were real revisions and which were identical bytes.

After dedup, twelve distinct prototypes remained (~12,200 lines of JSX
total). A docmgr ticket (CLIM-JSX-001) was created with a design doc and this
diary.

### Prompt Context

**User prompt (verbatim):** "Look at [ls listing of 16 .jsx files] in ~/Downloads and copy them into this git init in sources/. Create a new docmgr ticket. Analyze it all, and design a shared package typescript react to do PBUI (presentation based UIs) in typescript. Create a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable. Check for duplicate files too."

**Assistant interpretation:** Import and dedupe the prototype files, then run a
full research/design pipeline: docmgr ticket, deep analysis of every
prototype, a comprehensive intern-oriented design/implementation guide for a
shared PBUI TypeScript React package, and reMarkable delivery.

**Inferred user intent:** Consolidate a family of hand-written CLIM-style
React prototypes into one reusable, typed library design so future apps stop
copy-pasting the same presentation/command machinery.

### What I did

- `cp` all sixteen files into `sources/`, then `md5sum sources/*.jsx | sort`.
- Removed four byte-identical duplicates:
  - `presentation-metrics(4).jsx` (== `presentation-metrics(1).jsx`)
  - `repl-ide(1).jsx` (== `repl-ide.jsx`)
  - `care-examiner(1).jsx` (== `care-examiner.jsx`)
  - `dynamic-windows-scheduler(1).jsx` (== `dynamic-windows-scheduler.jsx`)
- Created ticket: `docmgr ticket create-ticket --ticket CLIM-JSX-001 --title
  "PBUI: shared TypeScript React package for presentation-based UIs" --topics
  pbui,react,typescript,design`, plus the design doc and this diary via
  `docmgr doc add`.

### Why

- Checksum-first dedup avoids analyzing the same bytes twice and settles
  "is `(2)` a revision or a re-download?" objectively: `repl-ide(2).jsx` and
  the four `presentation-metrics` variants are all genuinely different files.

### What worked

- md5sum grouping cleanly split real revisions from re-downloads.
- docmgr scaffolding created the full ticket tree in one shot.

### What didn't work

- `cd sources` failed once (`(eval):cd:1: no such file or directory`) because
  the shell working directory had already moved into `sources/` in the prior
  compound command; harmless, retried with direct paths.

### What I learned

- The twelve survivors form four families: REPL/lisp-machine (3 files),
  presentation-metrics (4 revisions), analysis apps (bayes, care-examiner,
  scheduler), and editor/design tools (design-kit, schema-schematic-editor).
- All are single-file CLIM/Genera Dynamic-Windows homages: typed
  presentations, command tables with typed arguments, an "accepting" input
  state, and a listener pane.

### What was tricky to build

- Nothing yet; mechanical step.

### What warrants a second pair of eyes

- Confirm dropping the `(1)`/`(4)` duplicates is acceptable — the originals
  remain untouched in `~/Downloads`.

### What should be done in the future

- N/A

### Code review instructions

- `md5sum sources/*.jsx | sort` should show 12 unique hashes.

### Technical details

- Duplicate groups (md5): `35612651` presentation-metrics(1)/(4);
  `4618fd08` repl-ide/(1); `7ac2e26d` care-examiner/(1); `d7056913`
  dynamic-windows-scheduler/(1).

## Step 2: Parallel deep analysis of the four prototype families

Twelve prototypes at ~1,000 lines each is too much to serially read with good
retention, and the families are independent, so the analysis was fanned out
to four parallel research agents, one per family. Each agent was primed with
the CLIM/Dynamic-Windows conceptual vocabulary (presentation, ptype, command
table, input context, accept loop, mouse-doc line, listener) and asked for
line-anchored evidence plus a list of reusable abstractions the family
suggests for the shared package.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** The analysis phase of the same request.

**Inferred user intent:** Evidence-based design, not guesswork.

### What I did

- Spawned four parallel agents over: (a) repl-ide + repl-ide(2) +
  wip-lisp-machine, (b) the four presentation-metrics revisions with an
  explicit evolution-ordering question, (c) bayes-layer-analysis +
  care-examiner + dynamic-windows-scheduler, (d) design-kit +
  schema-schematic-editor.
- Each agent was instructed to cite `file.jsx:line` for every major claim and
  to flag duplicated helper code across files (extraction candidates).

### Why

- Families share internal lineage; comparing within a family surfaces the
  evolution of the abstractions, which directly tells us which shapes are
  stable enough to standardize in the package.

### What worked

- Fan-out kept each agent's reading load at 2–4 files (~2,500–4,400 lines).
- All four family reports came back with dense line-anchored evidence and
  converged on the same core abstraction list independently.

### What didn't work

- N/A.

### What I learned

Key cross-family findings (full detail in the design doc):

- Only some prototypes are "real" PBUIs. `bayes-layer-analysis.jsx` is a
  static block-registry document renderer; `repl-ide*.jsx` are notebook/REPL
  IDEs with presentation-*adjacent* widgets but no ptype system. The genuine
  PBUIs are wip-lisp-machine, care-examiner, dynamic-windows-scheduler,
  design-kit, schema-schematic-editor, and all four presentation-metrics
  variants.
- The accept-loop state machine (`advance` / `startCommand` / `supplyArg` /
  `abort`, Escape aborts, first-arg seeded from the invoking presentation) is
  re-implemented in near-identical form in at least six files — the single
  strongest extraction candidate.
- Two presentation-attachment styles coexist: wrapper components
  (`Pres`/`SPres`/`P`/`PG` reading a React context) and prop factories
  (`presProps`, `taskPresProps`) spread onto arbitrary DOM/SVG. metrics(3)
  proves presentations need not be DOM at all (canvas hit-record protocol).
  Conclusion: headless core + medium adapters.
- Type matching evolved from exact string equality → `any` wildcard →
  a real parent-chain lattice (`PTYPE_PARENT`/`typep` in the scheduler) plus
  coercions (`coerceFirst` in metrics(2)) — the package needs a subtype
  lattice with translator-style coercions.
- Output records: the scheduler and schema editor keep printed object
  references alive as clickable presentations forever (`S/B/TASKREF` part
  algebra; `{parts:[...]}` lines); metrics(1) had this and later variants
  regressed. Must be first-class in the package.
- Every file hand-rolls the same chrome: inverse mouse-doc line, status line
  with input-state, viewport-clamped hard-shadow context menu with Abort
  footer, blinking block cursor, marching-ants accepting outline, dim/inert
  non-matching presentations, Genera monochrome theme, reduced-motion guard.

### Evolution of the metrics family

- Likely order: metrics(1) → metrics.jsx ("Metrics II") → metrics(3) (3D
  canvas) → metrics(2) ("v3", window manager + richest command objects).
- metrics(1)'s Promise-based `prompt()` (await accept() inside async command
  bodies) was abandoned by later variants but is worth offering as a facade
  over the FSM.

### What was tricky to build

- Keeping agent scope non-overlapping so line-anchored claims don't clash.

### What warrants a second pair of eyes

- Spot-check a few line anchors from each agent report against the sources.

### What should be done in the future

- N/A

### Code review instructions

- Verify anchors with `nl -ba sources/<file>.jsx | sed -n '<range>p'`.

### Technical details

- Analysis dimensions per file: domain model, presentation model, command
  system, input context/accept loop, listener, hover/mouse-doc, menus,
  layout/theming, graphics integration, live updates, reusable abstractions.

## Step 3: Import the original PBUI thesis (AITR-794)

Mid-analysis, the user pointed at `/tmp/aitr-794.md` — a markdown
transcription of Eugene C. Ciccarelli IV's MIT AI Lab Technical Report 794,
"Presentation Based User Interfaces" (August 1984). This is the primary
source that coined the PBUI term, predating CLIM. It was copied into the
ticket's `sources/` directory and a fifth analysis agent was launched to
distill its conceptual model (PPS model, PSBase, description language) with
line anchors, so the design doc's theory chapter is grounded in the original
text rather than folklore.

### Prompt Context

**User prompt (verbatim):** "Look at @/tmp/aitr-794.md and copy it into th sources/ of the ticket as well. it's the original paper about PBUIs"

**Assistant interpretation:** Add the thesis to the ticket workspace sources
and use it as theoretical grounding for the design.

**Inferred user intent:** The shared package should be faithful to the
original PBUI model, not just to the CLIM-flavored prototypes.

### What I did

- `cp /tmp/aitr-794.md <ticket>/sources/aitr-794.md` (3,250 lines, 262 KB).
- Launched a dedicated agent to read all 3,250 lines and produce a
  line-anchored distillation plus a thesis→CLIM→React/TS mapping table.

### Why

- The thesis defines the vocabulary (presentation data base, presenters,
  recognizers) that disambiguates what the package's core state model must
  be; the prototypes only show CLIM's later, interaction-centric view.

### What worked

- Ticket tree already had a `sources/` directory, so the paper slots into
  docmgr's expected layout.

### What didn't work

- N/A

### What I learned

- Thesis chapters: PPS model (Ch. 2), composition (Ch. 3), describing
  presentation systems (Ch. 4), PSBase substrate (Ch. 5), construction
  methodology (Ch. 6), open areas (Ch. 7).

### What was tricky to build

- N/A (mechanical), but synthesis must reconcile 1984 terminology with CLIM
  terminology used in the prototypes.

### What warrants a second pair of eyes

- The thesis→React mapping table in the design doc: terminology mappings are
  judgment calls.

### What should be done in the future

- N/A

### Code review instructions

- Paper at `<ticket>/sources/aitr-794.md`; check distillation anchors with
  `nl -ba`.

### Technical details

- `head -60` confirms title page: AITR-794, Eugene C. Ciccarelli IV, MIT AI
  Laboratory, August 1984.

## Step 4: Synthesize the design document

With all five analyses in (four prototype families + the thesis
distillation), the primary deliverable was written:
`design-doc/01-pbui-shared-package-analysis-design-and-implementation-guide.md`.
It is structured for an intern: theory chapter defining every term
(presentation, PDB, presenter/recognizer, ptype, input context, translator,
output record), evidence-based current-state analysis of all twelve
prototypes, an explicit convergence/divergence table, gap analysis against
the thesis, the `@pbui` five-package architecture with TypeScript API
sketches and ASCII diagrams, eight decision records, pseudocode for the key
flows, a seven-phase implementation plan, and a test strategy that turns the
thesis's round-trip invariant (`C*P == P*R(C)`, aitr-794.md:876-880) into a
property test.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Assistant interpretation:** The design/writing phase of the same request.

**Inferred user intent:** A single onboarding document good enough that a new
contributor could start implementing `@pbui` Phase 0 without further
context.

### What I did

- Wrote the ~950-line design doc, citing `file.jsx:line` evidence throughout.
- Spot-checked five line anchors from the agent reports against the sources
  with `nl -ba | sed -n`; all five matched exactly
  (`dynamic-windows-scheduler.jsx:44-50` PTYPE_PARENT/typep/lattice,
  `care-examiner.jsx:70-76` Ctx/typeMatch/Pres,
  `presentation-metrics(2).jsx:983` coerceFirst,
  `wip-lisp-machine.jsx:478-482` hotParts,
  `aitr-794.md:876-880` the round-trip invariant).

### Why

- Decision records (D1–D8) capture exactly the places where prototypes
  disagreed, so future readers don't re-litigate wrapper-vs-prop-factory or
  string-types-vs-lattice.

### What worked

- The family evolution analysis made most design decisions self-evident:
  wherever a later prototype revisited a choice, it picked the option we
  standardize on (lattice, id refs, parts-based output, applicability
  predicates).

### What didn't work

- N/A.

### What I learned

- The one regression in the most mature prototype (metrics(2) dropped
  presentation-bearing transcripts) is the strongest argument for a shared
  package: features silently disappear when machinery is copy-pasted.

### What was tricky to build

- Reconciling 1984 thesis vocabulary with CLIM vocabulary without confusing
  an intern: resolved by a three-column mapping table (thesis → CLIM →
  @pbui) and by stating explicitly that React's VDOM is *not* the
  presentation data base.
- ASCII-only diagrams were chosen deliberately: the doc must survive
  pandoc/xelatex PDF rendering for reMarkable.

### What warrants a second pair of eyes

- Decision D5 (ObjectRefs + Resolver): the escape hatch for immediate values
  (`kind: "value"`) is under-specified.
- Phase estimates (Section 9) are optimistic single-engineer figures.

### What should be done in the future

- Confirm the `@pbui` npm scope before Phase 0 (open question 5).

### Code review instructions

- Start with the design doc Sections 4 (evidence) and 7 (decisions); verify
  anchors with `nl -ba sources/<file> | sed -n 'N,Mp'`.
- The doc's claims about duplication can be verified quickly:
  `rg -n "advance|startCommand|supplyArg" sources/`.

### Technical details

- Doc structure follows the skill's writing-style order: summary → problem →
  theory → current state → gaps → architecture → decisions → flows → phases
  → tests → risks → references.

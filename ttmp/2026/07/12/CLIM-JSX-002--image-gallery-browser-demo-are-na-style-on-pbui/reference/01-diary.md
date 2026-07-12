---
Title: Diary
Ticket: CLIM-JSX-002
Status: active
Topics:
    - pbui
    - react
    - typescript
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://apps/demos/src/demos/gallery/GalleryDemo.tsx
      Note: The gallery app (domain, ptypes, 16 commands, views)
    - Path: repo://apps/demos/src/demos/gallery/art.tsx
      Note: Seeded generative artwork renderer
ExternalSources: []
Summary: Implementation diary for the are.na-style image gallery browser demo built on @pbui.
LastUpdated: 2026-07-12T18:39:09.997829297-04:00
WhatFor: Record how the gallery demo was designed, built, and verified.
WhenToUse: Read before extending the gallery demo or reusing its patterns.
---


# Diary

## Goal

Build an are.na-style image gallery browser as a new PBUI application (not a
port): images, tags and channels as typed presentations, with title and
attribute editing flowing through the command loop. Capture design
decisions, implementation, failures, and verification.

## Step 1: Domain design — what is a presentation in a gallery?

The whole point of doing this app on @pbui is that "an image browser with
tags" maps naturally onto the presentation model: an image card, the tag
chips *inside* that card, the tag list in the sidebar, a channel row, and a
tag name printed to the listener are all presentations of the same handful
of domain objects. Editing then needs no forms: renaming, attribute
editing, tagging and channel connections are commands with typed arguments,
and the accept loop supplies them by pointing or typing.

Domain model chosen: `Image {id, title, artist, year, medium, source, seed,
palette, tags[], channels[]}`, `Channel {id, name}`, a tag universe
(`tags: string[]`, normalized to kebab-case), plus view state in the world
(`filter: tag|channel|null`, `selectedId`). Images are deterministic
generative SVG artworks (seeded shapes over six palettes) so the demo is
fully self-contained — no network fetches, and "Shuffle Artwork" becomes a
fun edit command.

### Prompt Context

**User prompt (verbatim):** "ok, can you make an image gallery browser application with tags and editing title and attributes, maybe something like are.na. Keep a detailed diary (see skill for format), commit at appropriate intervals"

**Assistant interpretation:** A new demo app in the @pbui monorepo —
are.na-flavored gallery (cards, tags, channels/collections) where titles
and attributes are editable, built with the established PBUI machinery,
with diary + commits.

**Inferred user intent:** Prove @pbui works for a "normal" product-shaped
app, not just Genera cosplay recreations — and grow the demo suite.

### What I did

- Created ticket CLIM-JSX-002 with tasks and this diary.
- Sketched the ptype set: `image`, `tag`, `channel`, `attribute`
  (menu-argument only), plus builtin `string`/`number`.
- Decided tag semantics: any typed token is a valid tag (`parse` normalizes
  and always succeeds), so `Tag Image` creates new tags on the fly — the
  are.na "folksonomy" feel — while clicking an existing chip supplies it by
  pointing.

### Why

- Tags as first-class presentations (not strings in the UI) is what makes
  filtering, untagging and cross-pane highlighting free: the sidebar chip,
  card chips, and transcript mentions are all `{kind:"tag", id}` refs.

### What worked

- The domain fit the model with zero friction; no new core features needed.

### What didn't work

- N/A at design time.

### What was tricky to build

- Deciding where view state (filter, selection) lives: in the world store,
  not React state, so commands can change it (`Filter By Tag`,
  `Show Image`) and narrate it to the listener.

### What warrants a second pair of eyes

- Tag `parse` accepting *anything* means typos create tags; acceptable for
  the demo, but a real app might want confirm-on-new.

### What should be done in the future

- N/A

### Code review instructions

- Domain + ptypes at the top of
  `apps/demos/src/demos/gallery/GalleryDemo.tsx`.

### Technical details

- Tag normalization: `s.trim().toLowerCase().replace(/\s+/g, "-")` —
  "corporate surrealism" → `corporate-surrealism`.

## Step 2: Implementation

Wrote `art.tsx` (seeded `mulberry32` shape compositor over six palettes;
same seed → same piece, rendered at any size) and `GalleryDemo.tsx`
(~650 lines): world store, ptypes with printers/describers/parsers, 16
commands, and four view regions — Channels/Tags sidebar, gallery grid of
`ImageCard`s, Inspector, Listener. Registered slug `gallery` in `demos.ts`.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Commit (code):** 6a7edb4 — ":sparkles: gallery demo: are.na-style image
browser with tags, channels, attribute editing"

### What I did

- Commands: `Show Image` (default for image → inspector), `Rename Image`
  (typed string, min-length validate), `Set Attribute` (menu-choice
  artist/year/medium/source + typed value), `Tag Image` (click chip or type
  new), `Untag Image` and `Disconnect From Channel` (with `where`
  predicates reading the already-collected image arg so only carried
  tags / connected channels are eligible), `Shuffle Artwork`,
  `Connect To Channel`, `Filter By Tag` (default for tag), `Show Channel`
  (default for channel), `Rename Channel`, globals `New Channel`,
  `New Tag`, `Clear Filter`, `Clear Listener`, `Show Herald`.
- Nested sensitivity: tag chips live inside image cards; mousemove
  stopPropagation makes the innermost presentation win, so clicking a chip
  filters while clicking the card inspects.
- Inspector wraps the large artwork in a `quiet` presentation (menuable,
  no hover flash over the picture) and lists channel connections as
  presentations.

### Why

- The `where`-constrained second argument is the showcase: during
  `Untag Image` only the two tags the image actually carries grow
  marching ants; all other 30+ tag presentations stay inert.

### What worked

- Typecheck clean on the first run; only cleanup was removing a stray
  `as never` cast on an `api.printErr` part argument.

### What didn't work

- Nothing at build time; verification hiccups below.

### What I learned

- `soFar` values in `where`/`validate` make cross-argument constraints
  trivial — no engine changes needed for "only tags this image carries".

### What was tricky to build

- The Inspector shows the *selected* image while commands may target any
  image; keeping "selection" a command effect (`Show Image`) rather than a
  click side-effect keeps the interaction honest (right-clicking a card
  does not select it).

### What warrants a second pair of eyes

- `New Channel` uses `Date.now() % 100000` for ids — collision-possible in
  principle; fine for a demo.
- `Rename Channel` normalizes names to kebab-case (are.na style); confirm
  that's wanted.

### What should be done in the future

- Persistence (localStorage) and image import (drag/drop or URL) would make
  it a usable tool; drag-to-connect via DnD translators once core grows
  them.

### Code review instructions

- `apps/demos/src/demos/gallery/{GalleryDemo,art}.tsx`; validate with
  `pnpm --filter @pbui/demos typecheck` and `pnpm demos` → #gallery.

## Step 3: Browser verification and delivery

Drove the full editing surface with Playwright against the running dev
server and archived a screenshot.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

### What I did

Verified programmatically, in one scripted session:

- Image menu: `Show Image / Rename Image … / Set Attribute … / Tag Image …
  / Untag Image … / Shuffle Artwork / Connect To Channel … / Disconnect
  From Channel … / Describe / Abort`.
- Rename: prompt rendered `Rename Image (image: Signal IV) (new-title: a
  STRING) ⇒`, typed "Severance Package IX", card + narration updated.
- Set Attribute: choice menu `[artist, year, medium, source]` → typed
  "B. Munari" → `… artist set to B. Munari.`
- Tag Image: 32 tag presentations went eligible; typed the brand-new
  "corporate surrealism" → normalized chip `corporate-surrealism`
  appeared on the card and in the sidebar (×1 count).
- Untag Image: only the image's own tags (`archive`,
  `corporate-surrealism`) eligible out of 36 tag presentations on screen —
  the `where` constraint working.
- Filter By Tag via chip click → "1 of 12 — tag: corporate-surrealism";
  Clear Filter from the background menu; Show Channel → "4 images".
- Command line end-to-end: `connect to channel severance to-print` parsed
  both positional args (image by title prefix, channel by name) and
  connected.
- Screenshot (archived at `various/gallery-screenshot.png`) also captures
  the cross-pane related-hover: hovering `hard-edges` outlines its sidebar
  row, its transcript mentions, and the inspector chip simultaneously —
  the registry's multiple-presentations-of-one-object behavior.

### What didn't work

- Two Playwright strict-mode locator failures (not app bugs): `hasText:
  'Tag Image'` also matched "Untag Image …", and `getByText('artist')`
  matched both the menu item and the inspector table cell. Fixed the
  script with exact-regex menu-item locators.
- One earlier session quirk: `page.goto` to the same hash URL is a
  same-document navigation (no remount) — used `page.reload()` for clean
  boots.

### What was tricky to build

- Nothing in the app; the verification needed care to right-click the
  *card* (presentation) vs. empty pane space (background menu).

### What warrants a second pair of eyes

- The `inspectorArtist: 0` observation during verification is correct
  behavior (the renamed image was never `Show Image`d, so the inspector
  showed a different image) but reads surprising in the transcript.

### Code review instructions

- `pnpm demos` → http://localhost:5199/#gallery; try the herald's
  suggested flows. Screenshot in ticket `various/`.

### Technical details

- Verified flows return data, not eyeballs: menu contents, eligible/inert
  counts, prompt strings, and transcript lines were all asserted from the
  Playwright script.

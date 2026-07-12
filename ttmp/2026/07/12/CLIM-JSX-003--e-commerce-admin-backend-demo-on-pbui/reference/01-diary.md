---
Title: Diary
Ticket: CLIM-JSX-003
Status: active
Topics:
    - pbui
    - react
    - typescript
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://apps/demos/src/demos/ecommerce/data.ts
      Note: Domain model and seed
    - Path: repo://apps/demos/src/demos/ecommerce/engine.ts
      Note: Command table with state-sensitive lifecycle (the app's core)
    - Path: repo://apps/demos/src/demos/ecommerce/views.tsx
      Note: Five tab views
ExternalSources: []
Summary: Implementation diary for the multi-tab e-commerce admin backend demo on @pbui.
LastUpdated: 2026-07-12T18:49:36.939303851-04:00
WhatFor: Record how the back-office demo was designed, built, and verified, including the theme change and the tab-navigation gap.
WhenToUse: Read before extending the ecommerce demo or designing multi-view PBUI apps.
---


# Diary

## Goal

Build a full-featured e-commerce admin backend ("Storefront Back Office")
as a PBUI demo with multiple tabs/views, and soften the theme's hard
drop shadows to plain borders per user feedback.

## Step 1: Theme feedback — borders instead of hard shadows

Before the new app, the user pushed back on the aggressive `4px 4px 0` /
`6px 6px 0` hard offset shadows. A repo-wide grep found exactly three:
the theme's context menu, the launcher card, and the gallery's selected
card. All three became border-only (the gallery selection compensates the
thicker border with reduced padding so cards don't shift).

### Prompt Context

**User prompt (verbatim):** "no drop shadows that are this aggressive / just border. Now create a full featured e-commerce backend, with multiple tabs / views"

**Assistant interpretation:** (a) remove the hard offset shadows repo-wide,
borders only; (b) build a new multi-view admin-backend demo on @pbui,
continuing the diary + commit discipline.

**Inferred user intent:** Tune the shared aesthetic (the shadows read as
too loud) and keep stress-testing @pbui against product-shaped apps —
this time one with real information architecture (tabs, tables,
lifecycles).

**Commit (code):** 23e0805 — ":art: borders instead of hard offset drop
shadows (menus, launcher, gallery selection)"

### What I did

- `rg -n "box-shadow|boxShadow" packages apps` → 3 hits; removed all
  three (theme `pbui-menu`, `launcher.css`, gallery `ImageCard`).

### Why

- Fixing it in `@pbui/theme-genera` fixes every demo at once — the point
  of the shared theme package.

### What worked / What didn't work

- Mechanical; nothing failed.

### What warrants a second pair of eyes

- If the flat menus feel too flat over busy panes, a 1px outline offset
  could be added to the theme — deliberately not done ("just border").

### Code review instructions

- `git show 23e0805`.

## Step 2: Design — an admin backend as a presentation system

The interesting design question: what do tabs mean in a PBUI? Answer
chosen: tabs are presentations of VIEW objects with `Switch To View` as
their default command — so tab navigation goes through the same command
loop as everything else, is narrated to the listener, and works from the
command line (`switch to view inv⇥`). Entity commands that navigate
(`Show Order`, `Orders For Customer`, `Filter By Status`) then compose
naturally: they set `activeTab` + selection/filter in the world store.

Domain: `Product {sku, priceCents, stock, category, archived}`,
`Customer`, `Order {number, customerId, lines[], status, day}` with a
five-state lifecycle (pending → paid → fulfilled, with refunded and
cancelled exits). View state (activeTab, three selections, orderFilter)
lives in the world store so commands own it.

The showcase feature is **state-sensitive lifecycle menus**: `Mark Paid`
carries `appliesTo: orderIs(["pending"])`, `Fulfill Order` requires paid,
`Refund Order` paid|fulfilled — the right-click menu on an order changes
as the order moves through its life, with zero menu wiring.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

### What I did

- Split into three files: `data.ts` (domain + seed + world facade),
  `engine.ts` (5 ptypes, 22 commands, resolver), `views.tsx` (TabBar +
  five views), `EcommerceDemo.tsx` (shell).
- Commands beyond lifecycle: `New Order` (3-arg chain: customer →
  product with `where: !archived` → qty with `[default 1]` and 1–99
  validation), `Add Line` (product `where` excludes lines already on the
  order), `Set Price` (dollars→cents), `Adjust Stock` (cross-argument
  validation: delta cannot take the already-collected product's stock
  negative), `Set Category` (menu arg fed from live categories),
  `Archive/Restore` (complementary `appliesTo`), `Email Customer` (fake),
  three filter commands retargeting the Orders tab, `Low Stock Report` /
  `Sales Summary` printing live product/order refs.
- Status chips are `order-status` presentations with glyphs and text-only
  accent colors (○ pending gold, ● paid / ✓ fulfilled teal, ↩ refunded /
  ✕ cancelled coral) — chrome stays monochrome per the theme rule.

### Why

- Fulfillment touching inventory (decrement on fulfill, restore on refund
  of fulfilled, refuse on insufficient stock with the shortfall printed
  as live product parts) makes the Orders and Inventory tabs genuinely
  coupled — which is what makes cross-view presentations valuable.

### What was tricky to build

- Money as integer cents with a dollars-typed `Set Price` argument —
  conversion at the command boundary, formatting via one `fmtMoney`.
- `Add Line`'s `where` reads `soFar["order"]` to exclude products already
  on that order — the same cross-argument pattern as the gallery's Untag.

### What warrants a second pair of eyes

- `New Order` hardcodes day "Jul 12"; unit prices snapshot at order time
  (deliberate — a later `Set Price` must not rewrite history).
- Refund restores stock only if the order was fulfilled — check that
  matches expectations.

### What should be done in the future

- See Step 3's PORTING-GAP about tab navigation during accepts.

### Code review instructions

- Start at `apps/demos/src/demos/ecommerce/engine.ts` (the command
  table is the app); then `views.tsx`.

## Step 3: Verification — and a real engine gap found

Browser-verified the whole surface with Playwright, all assertions
programmatic.

### Prompt Context

**User prompt (verbatim):** (see Step 1)

**Commit (code):** e26e193 — ":sparkles: e-commerce back-office demo:
five tabs, state-sensitive order lifecycle"

### What I did

- Verified: pending-order menu shows exactly `Show Order / Mark Paid /
  Cancel Order / Add Line … / Describe`; after Mark Paid the same order's
  menu becomes `Fulfill Order / Refund Order …`; Fulfill narrates "#1012
  fulfilled — stock decremented."
- Status-chip click → "2 of 12 — status: pending"; `New Order` accept
  chain: 3 eligible customer mentions on screen, product supplied by
  typing `mug`, qty by empty-Enter default → "Created #1013: 1× Diner Mug
  12oz for Bo Lindqvist — $18.00, pending."
- Command line: `set price tee-blk 35` ($32.00 → $35.00), `low stock
  report` (3 products with live refs), `orders for customer ada`.
- Cross-jump: clicking a customer chip in an orders row opened the
  Customers tab.
- Adjust Stock: `-999` rejected with "only 2 in stock — cannot go
  negative"; `24` applied 2 → 26.
- Screenshots archived: `various/ecommerce-orders.png`,
  `various/ecommerce-dashboard.png`.

### What didn't work / gaps found

- **Engine gap (recorded as PORTING-GAPS in EcommerceDemo.tsx):** you
  cannot switch tabs while an input context is active — the engine
  swallows clicks on non-matching presentations, so VIEW tabs go inert
  mid-command. If the customer you want isn't visible in the current
  tab, you must abort, navigate, and restart (or type the name). CLIM
  kept frame navigation live during accepts; core needs an
  "alwaysActive" presentation mode or command-during-accept translators.
  The herald text was corrected to not overpromise cross-tab supply.
- A momentary confusion during verification: 6 inert VIEW presentations
  with only 5 tabs — the 6th was the word "Orders" inside a listener echo
  line. Transcript mentions are live presentations, so they dim during
  accepts too. Correct behavior, briefly alarming.

### What I learned

- "Ada has 0 orders" from the seeded RNG made the `orders for customer`
  demo line anticlimactic — seed data should guarantee every showcased
  query has results.

### What warrants a second pair of eyes

- The tab-during-accept gap is the second coercion-adjacent limitation
  found by an app (after the schema editor's click-fall-through); both
  point at the same core design area: what stays interactive during an
  input context.

### Code review instructions

- `pnpm demos` → http://localhost:5199/#ecommerce; walk the herald's
  suggestions. `pnpm typecheck && pnpm test` green (28 core tests).

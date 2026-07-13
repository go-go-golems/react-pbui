# @go-go-golems/pbui-demos

Seven applications that exercise the PBUI packages, one Vite app, one launcher. Each demo is a complete, self-contained example of the pattern; together they are also the integration test bed — the `e2e/` suite drives every one of them in a real browser.

```sh
pnpm demos          # from the repo root → http://localhost:5199
```

## Reading order

The demos are ordered by what they teach. Read them in this order if you are learning the library; each one's file header states what it demonstrates.

| Demo | Source | What it teaches |
|---|---|---|
| **Hello PBUI** | `src/demos/hello/` | the smallest complete app: one ptype, five commands, the standard shell. Start here. |
| **CARE Examiner** | `src/demos/care-examiner/` | live simulation ticks under accepts; value presentations (`valueRef` legend swatches); typed validation |
| **Dynamic Windows Scheduler** | `src/demos/scheduler/` | SVG presentations with hit rects; a real subtype lattice (`milestone ⊂ task`); transcript refs that stay live forever |
| **Presenta Metrics** | `src/demos/metrics/` | the two-click argument flow (Assign Port); ordered `isDefaultFor` as a toggle; multiple presentations of one object |
| **Schema Schematic Editor** | `src/demos/schema/` | location accepts on a canvas; ghost/rubber-band previews from accept state; coercions (pin→location); `fallthrough` participation |
| **Gallery** (are.na-style) | `src/demos/gallery/` | a product-shaped app: nested presentations (chips in cards), `where` predicates over already-collected args, on-the-fly object creation from typed input |
| **Storefront Back Office** | `src/demos/ecommerce/` | the full toolkit: typed builder throughout, state-sensitive lifecycle menus, snapshot undo + ActivityPane, `active` tabs usable mid-command, cross-tab argument supply |

`#bench` (hidden from the launcher) is the render-budget harness used by the `@perf` e2e spec.

## Writing a new demo

`PORTING-NOTES.md` in this directory is the recipe: world in a `Store<T>`, ptypes, builder commands, engine construction, presentation-wrapped views, the standard shell. The rules at the bottom (typecheck + e2e must stay green; record genuine library gaps as `PORTING-GAPS` header comments instead of patching packages) are how the demos stayed honest as the library evolved — two engine features (participation modes, central staleness) exist because demo gaps demanded them.

## The e2e suite

`e2e/` contains one spec per demo plus `keyboard.spec.ts` (a mouse-free command flow) and `bench.spec.ts` (`@perf`). They run against a production preview build (no HMR):

```sh
pnpm exec playwright test --project=chromium   # 26 tests
pnpm exec playwright test --project=perf       # render budget
```

`e2e/helpers.ts` is the shared vocabulary; two hard-won rules are encoded there — reload after hash navigation (same-document navigation does not remount), and select menu items by exact text ("Tag Image …" vs "Untag Image …" collide under substring matching).

# Changelog

## 2026-07-12

- Initial workspace created


## 2026-07-12

Wrote the intern-level design doc for part A: typed command builder (compile-to-v1, resolve-then-run, central stale abort), keyboard/a11y layer (roving focus per pane, Tab-cycling eligible presentations, ARIA menus, live regions, listener history), and undo via invocation records (snapshot + explicit-inverse, linear-only). 5 decision records, 6 phases.

### Related Files

- /home/manuel/code/wesen/2026-07-12--clim-jsx/ttmp/2026/07/12/CLIM-JSX-004--pbui-v2-part-a-typed-command-authoring-keyboard-accessibility-undo-via-invocation-records/design-doc/01-typed-commands-keyboard-a11y-and-undo-analysis-design-and-implementation-guide.md — Primary deliverable


## 2026-07-12

Implemented all phases: A1 typed builder (73fde62), A3 invocations+undo+ActivityPane+live history (017b51d), A2 ecommerce migration -150 lines/zero unwraps + SKU presentations (2255ae5), A4 ARIA menus/live regions/listener history (00774ff), A5 roving focus + keyboard accepts + keyboard-only e2e (2eabad5). Deviations recorded in diary: soFar loosely typed in descriptor callbacks; snapshot-after-guards convention.


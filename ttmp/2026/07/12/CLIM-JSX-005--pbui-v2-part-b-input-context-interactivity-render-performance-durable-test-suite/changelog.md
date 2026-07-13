# Changelog

## 2026-07-12

- Initial workspace created


## 2026-07-12

Wrote the intern-level design doc for part B: participation modes (gated/active/fallthrough) + duringAccept commands, targeted per-presentation subscriptions + eligible-set cache with bench budget, and the durable verification suite (7 e2e specs from recorded sessions, RTL, golden transcripts, CI). 5 decision records, 4 phases; tests land first.

### Related Files

- /home/manuel/code/wesen/2026-07-12--clim-jsx/ttmp/2026/07/12/CLIM-JSX-005--pbui-v2-part-b-input-context-interactivity-render-performance-durable-test-suite/design-doc/01-live-during-accept-semantics-targeted-subscriptions-and-ci-verification-analysis-design-and-implementation-guide.md — Primary deliverable


## 2026-07-12

Implemented all phases: B1 verification suite 22 e2e + 18 RTL + goldens + CI (6d38480, 73fde62), B2 targeted subscriptions + eligible cache measured at 1.98 renders/hover @N=2000 (4d2f3ae), B3 participation modes closing both PORTING-GAPS with e2e proofs (00774ff, 46610ca). Final counts: 53 core, 19 RTL, 26 e2e, perf budget green.


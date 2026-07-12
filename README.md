# pbui — presentation-based UIs for TypeScript + React

A CLIM / Genera Dynamic-Windows style interaction model as a set of shared
packages: every object on screen is a *typed presentation* of a domain
object. Hover it and a documentation line tells you what the mouse will do;
right-click it for a menu of exactly the commands applicable to its type;
when a command needs an argument, matching presentations grow marching-ants
outlines and everything else goes inert — click one (or type) to supply it.
Objects printed to the listener transcript remain live presentations
forever.

Grounded in E. C. Ciccarelli's *Presentation Based User Interfaces* (MIT
AITR-794, 1984) and twelve hand-written JSX prototypes preserved in
`sources/`. Full analysis and design doc in the CLIM-JSX-001 ticket under
`ttmp/`.

## Packages

| package | what |
|---|---|
| `@pbui/core` | framework-free engine: ptype lattice with print/parse codecs, presentation registry (the "presentation data base"), command tables with typed args, accept-loop FSM, coercions, output records, pull-derived pointer doc |
| `@pbui/react` | `PbuiProvider`, headless `usePresentation`, `<Presentation>` / `<SvgPresentation>`, `usePbuiSurface` |
| `@pbui/listener` | transcript + morphing prompt line + command line (prefix match, completion) |
| `@pbui/chrome` | context menus, mouse-doc bar, status line, pane frames |
| `@pbui/theme-genera` | the monochrome look: `import "@pbui/theme-genera/genera.css"` |

## Demos

```sh
pnpm install
pnpm demos          # http://localhost:5199
```

Five demos in `apps/demos`: **Hello PBUI** (tutorial), plus ports of the
original prototypes — **CARE Examiner**, **Dynamic Windows Scheduler**,
**Presenta Metrics**, **Schema Schematic Editor**. See
`apps/demos/PORTING-NOTES.md` for the porting recipe.

## Develop

```sh
pnpm test        # core unit tests (vitest)
pnpm typecheck   # strict tsc across the workspace
```

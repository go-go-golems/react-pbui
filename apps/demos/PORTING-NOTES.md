# Porting a prototype from sources/ onto @pbui

Read `src/demos/care-examiner/CareExaminerDemo.tsx` first — it is the
reference port. Then skim the package sources you'll use:
`packages/core/src/{types,ptype,command,engine,docline}.ts`,
`packages/react/src/{provider,use-presentation,presentation}.tsx`,
`packages/chrome/src/*`, `packages/listener/src/*`.

## The recipe

1. **World**: plain TS state in a `Store<T>` (`src/lib/store.ts`); React
   reads via `useStore(store)`; commands mutate via `store.update`.
2. **ptypes**: `new PTypes<World>()`, `defineBuiltinPtypes(ptypes)` (adds
   `number`/`string`), then `ptypes.define<T>({name, supertypes?, print,
   describe?, parse?, defaultCommand?})`. `print` receives the RESOLVED
   object (never undefined). `parse` is the keyboard supply path.
3. **Commands**: `new CommandTable<World>()`, `.defineAll([...])`. Args:
   `{name, type, input?: "presentation"|"typed"|"menu", distinct?, where?,
   validate?, default?, options?}`. `run(args, api)` must return
   void/Promise<void> — wrap `array.push(...)` in braces. Resolve refs with
   `api.resolve(args["x"]!)` and handle `undefined` (stale) with
   `api.printErr("... presentation was stale.")`. `global: true` puts a
   command on the background menu instead of object menus.
4. **Engine**: `new PbuiEngine<World>({ptypes, commands, world, resolver,
   idleDoc})`. The `resolver` maps `ObjectRef {kind, id}` → live object.
   Use `valueRef(v)` for immediates (numbers, month indices, levels).
5. **Views**: wrap domain objects in `<Presentation type object label>`
   (HTML span; `block` for div) or `<SvgPresentation ... hitRect={{x, y,
   width, height}}>` inside an `<svg>`. Never wire your own mouse handlers
   on presentations — the wrapper does the whole gesture protocol.
6. **App shell** (copy from care-examiner): `PbuiProvider` →
   `usePbuiSurface()` spread on the root `div.pbui-root` → panes →
   `<Listener prompt="FOO> ">` in a `Pane` → `<ContextMenuHost/>`,
   `<MouseDocBar/>`, `<StatusLine/>`. Include the `.demo-back` link and the
   StrictMode-safe herald guard (`heraldRan` ref).
7. **Output**: `api.print(...)` takes strings and parts. Use
   `{t: "pres", type, ref, label}` parts (or a small helper) so objects
   printed to the listener remain live presentations.

## Special techniques

- **Location accepts** (clicks on empty canvas): define a `location` ptype
  (`parse` accepts `"x,y"`), give the arg `input: "typed"`... but for
  click-supply, add an onClick on the svg/canvas that checks
  `engine.getState().accept?.spec.type === "location"` and calls
  `engine.supplyValue({type: "location", ref: valueRef(\`${x},${y}\`),
  label: \`(${x},${y})\`})` with grid-snapped coords. Read
  `engine.getState().accept` to draw ghost previews / rubber bands.
- **Menu-valued args**: `input: "menu"` + `options: () => [{label, ref}]`
  opens a chooser at the last pointer position automatically.
- **Live ticks**: `setInterval` in a `useEffect` calling
  `store.update(tick)`; accepting highlights survive because they are
  derived state.
- **quiet**: pass `quiet` on container presentations (whole panes/windows)
  so they don't flash hover outlines over their contents.

## Rules

- Do NOT modify anything under `packages/` or other demos' directories, and
  do NOT edit `src/demos.ts` (entries are pre-registered). Your demo lives
  entirely in `src/demos/<slug>/`.
- `pnpm --filter @pbui/demos typecheck` must pass (strict TS,
  noUncheckedIndexedAccess: index access yields `T | undefined` — use `!`
  judiciously after bounds checks).
- Match the original prototype's feel: Genera monochrome (theme classes do
  it), CLIM echo/prompt conventions, `#<TYPE NAME>` printed reps.
- If you hit a genuine gap in @pbui (something the port cannot express),
  work around it locally and record it in a `PORTING-GAPS` comment at the
  top of your demo file — do not patch the packages.

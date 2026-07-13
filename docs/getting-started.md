# Getting Started with PBUI

This guide builds a small, complete presentation-based application — a bug tracker — from an empty file. By the end you will understand the five things every PBUI application consists of: a world, presentation types, commands, an engine, and views that register what they present. More importantly, you will understand *why* the pieces divide this way, because the division is what buys you the behavior you never write: context menus, argument collection, keyboard operation, and an undo-capable command history all derive from declarations you are about to make.

**How to read this guide.** Each numbered section adds one piece and ends with a *checkpoint* — something you can verify before moving on. The code is complete enough to type in; where a body is routine, the guide says so and shows the interesting line. Terms of art are defined in one sentence the first time they appear; the User Guide's Chapter 2 (`docs/user-guide.md`) has the full vocabulary if a definition here feels too quick. You need React and TypeScript; you do not need any prior exposure to presentation-based interfaces.

**Before you start**, spend five minutes feeling the pattern you are about to build. Run the demos (`pnpm demos` at the repository root, then open http://localhost:5199 and pick *Hello PBUI*) and do three things: rest the pointer on a ship and read the black bar at the bottom of the screen; right-click a ship; then pick *Compare Ships …* from that menu and watch the screen split into things that answer the question and things that don't. Those three behaviors are what this guide teaches you to get for free.

**What you will build.** A one-screen bug tracker:

```
┌──────────────────────────────┬───────────────┐
│ BUGS                         │ ACTIVITY      │
│  crash on save     sev 1  …  │ ✓ Assign Bug  │
│  slow search       sev 2  …  │ ✓ File Bug    │
├──────────────────────────────┴───────────────┤
│ LISTENER                                     │
│ Command: Assign Bug (bug) bug-1              │
│   dev (a DEV) ⇒ Ada                          │
│ bug-1 assigned to Ada.                       │
│ TRACKER> _                                   │
├──────────────────────────────────────────────┤
│ #<BUG bug-2 "slow search" sev2> — L: Show…   │  ← the doc bar
│ [clock] you TRACKER: User Input              │  ← the status line
└──────────────────────────────────────────────┘
```

Every bug title, every developer name — in the table *and* in the listener's output — will be a live, right-clickable, keyboard-reachable object.

## 0. Setup

Inside this monorepo, a new app is a directory under `apps/` with the workspace packages as dependencies. Copy `apps/demos`' Vite configuration, or start from this `package.json` fragment:

```jsonc
// package.json (dependencies)
{
  "@go-go-golems/pbui-core": "workspace:*",
  "@go-go-golems/pbui-react": "workspace:*",
  "@go-go-golems/pbui-listener": "workspace:*",
  "@go-go-golems/pbui-chrome": "workspace:*",
  "@go-go-golems/pbui-theme-genera": "workspace:*",
  "react": "^18.3.1", "react-dom": "^18.3.1"
}
```

The packages export TypeScript source directly (`main: src/index.ts`), so any Vite-style bundler consumes them without a build step. Two lines belong in your entry point and are easy to forget — the theme import, and the root class that scopes it:

```ts
import "@go-go-golems/pbui-theme-genera/genera.css";
// ...and later, className="pbui-root" on your outermost element (Section 7)
```

> **Checkpoint.** `pnpm install` succeeds and a `console.log` from your `main.tsx` reaches the browser. Nothing PBUI-specific yet — that starts now.

## 1. The world

The **world** is PBUI's name for your application's own state, plus the functions commands will use to read and change it. It is plain TypeScript — the framework imposes nothing on it except one convention: update it immutably (replace state objects rather than mutating them), because undo will work by remembering previous state objects.

```ts
// world.ts
export interface Bug {
  id: string;
  title: string;
  severity: 1 | 2 | 3;              // 1 = critical
  status: "open" | "assigned" | "fixed";
  assignee: string | null;          // Dev id
}

export interface Dev { id: string; name: string }

export interface TrackerState {
  bugs: Bug[];
  devs: Dev[];
  selectedBugId: string | null;
}
```

You also need a tiny subscribable store — `get()`, `set()`, `update(fn)`, `subscribe(fn)`, about thirty lines. Do not write it; copy `apps/demos/src/lib/store.ts`, which also exports the `useStore` React hook you will use in Section 6. Then wrap store and lookups into the world object:

```ts
export interface World {
  store: Store<TrackerState>;
  bug(id: string): Bug | undefined;
  dev(id: string): Dev | undefined;
}

export function makeWorld(): World {
  const store = new Store<TrackerState>(seedState());   // a few bugs, a few devs
  return {
    store,
    bug: (id) => store.get().bugs.find((b) => b.id === id),
    dev: (id) => store.get().devs.find((d) => d.id === id),
  };
}
```

Give `seedState()` three or four bugs and two or three developers with memorable names ("Ada", "Bo") — you will be typing them at prompts shortly.

One design choice deserves a pause before you copy it: why does view state (`selectedBugId`) live in the world rather than in a React `useState`? Because selection should be a *command effect*. When "Show Bug" is a command that writes to the world, it automatically appears in menus, works from the keyboard and the typed command line, narrates itself to the output area, and shows up in the command history. A `useState` setter gets none of that.

> **Checkpoint.** `makeWorld().bug("bug-1")` returns a bug in a quick unit test or a console log.

## 2. Presentation types

A **presentation** is a form on screen that stands for one of your domain objects — and, unlike an ordinary rendered string, it *remembers* what it stands for. A **presentation type** (ptype) names a kind of presentation — `bug`, `dev` — and carries the four capabilities the engine will exercise for you: printing (object → canonical text), parsing (user-typed text → object), describing (rich output for the "describe" gesture), and optionally a default click action.

```ts
import { PTypes, defineBuiltinPtypes } from "@go-go-golems/pbui-core";

const ptypes = new PTypes<World>();
defineBuiltinPtypes(ptypes);        // registers "number" and "string"

ptypes.define<Bug>({
  name: "bug",
  print: (b) => `#<BUG ${b.id} "${b.title}" sev${b.severity}>`,
  describe: (b) => [
    { t: "bold", s: b.title },
    { t: "text", s: `  ${b.id}, severity ${b.severity}, ${b.status}` },
  ],
  parse: (text, w) => {
    const t = text.trim().toLowerCase();
    const b = w.store.get().bugs.find(
      (x) => x.id.toLowerCase() === t || x.title.toLowerCase().startsWith(t));
    return b
      ? { ok: true, value: b, ref: { kind: "bug", id: b.id }, label: b.id }
      : { ok: false, err: `${text} does not name a BUG` };
  },
});

ptypes.define<Dev>({
  name: "dev",
  print: (d) => `#<DEV ${d.name}>`,
  parse: (text, w) => {
    const t = text.trim().toLowerCase();
    const d = w.store.get().devs.find((x) => x.name.toLowerCase().startsWith(t));
    return d
      ? { ok: true, value: d, ref: { kind: "dev", id: d.id }, label: d.name }
      : { ok: false, err: `${text} does not name a DEV` };
  },
});
```

Two things to internalize before moving on:

- **`parse` is what runs when the user types instead of clicks.** Whenever a command is waiting for a BUG, the user can click any bug on screen *or* type `bug-7` (or a title prefix) at the prompt; `parse` decides what typed text means. The convention — accept prefixes, return one canonical `label` — is deliberate: the system prints one form, the user may type several, and both routes end in the same place.
- **`print` will never be called with `undefined`.** The engine looks the object up before printing and falls back to a generic form when it is gone. Write printers that dereference confidently (`b.title`, not `b?.title`).

> **Checkpoint.** In a scratch test: `ptypes.get("bug")!.parse!("bug-1", world)` returns `ok: true` with the right label, and a garbage string returns your error message. Thirty seconds now saves a confusing prompt later.

## 3. The resolver

Presentations never hold your objects; they hold **references** — small values like `{kind: "bug", id: "bug-7"}`. The **resolver** is the single function that turns references back into live objects, and `undefined` is one of its meaningful answers ("that object no longer exists"):

```ts
import type { Resolver } from "@go-go-golems/pbui-core";

const resolver: Resolver = {
  resolve: (ref) => {
    if (!("id" in ref)) return undefined;
    if (ref.kind === "bug") return world.bug(ref.id);
    if (ref.kind === "dev") return world.dev(ref.id);
    return undefined;
  },
};
```

Why the indirection? Because output lines keep references alive indefinitely. A bug's name printed to the listener ten commands ago must still work after the bug list has been refetched or partially deleted — and when the bug really is gone, the engine aborts the command with one standardized message. Your command bodies never receive a stale object and never check for one.

## 4. Commands

Commands are where the application's behavior lives — in a presentation-based application, they are the *only* place anything changes. The typed builder is the authoring surface. Read this section slowly; most of the framework's value is visible in it.

Start with the two part-helpers you will use in every narration. A **part** is a typed fragment of an output line, and the `pres` kind is what keeps printed names alive:

```ts
import type { OutputPart } from "@go-go-golems/pbui-core";

const bugPart = (b: Bug): OutputPart =>
  ({ t: "pres", type: "bug", ref: { kind: "bug", id: b.id }, label: b.id });
const devPart = (d: Dev): OutputPart =>
  ({ t: "pres", type: "dev", ref: { kind: "dev", id: d.id }, label: d.name });
```

Now the commands:

```ts
import { CommandTable, commandBuilder, arg } from "@go-go-golems/pbui-core";

const commands = new CommandTable<World>();
const c = commandBuilder(commands);

c.define({
  name: "Show Bug",
  args: { bug: arg.presentation<Bug>("bug") },
  isDefaultFor: ["bug"],                       // left-click on any bug runs this
  run: ({ bug }, api) => {
    world.store.update((s) => ({ ...s, selectedBugId: bug.id }));
    api.print("Inspecting ", bugPart(bug), ".");
  },
});

c.define({
  name: "Assign Bug",
  doc: "Give the bug to a developer.",
  args: {
    bug: arg.presentation<Bug>("bug"),
    dev: arg.presentation<Dev>("dev"),
  },
  appliesTo: (bug: Bug) => bug.status !== "fixed",   // menus are state-sensitive
  run: ({ bug, dev }, api) => {
    api.snapshotUndo(world.store);                   // one line: undoable
    world.store.update((s) => ({ ...s,
      bugs: s.bugs.map((b) => b.id === bug.id
        ? { ...b, assignee: dev.id, status: "assigned" } : b) }));
    api.print(bugPart(bug), " assigned to ", devPart(dev), ".");
  },
});

c.define({
  name: "Set Severity",
  args: {
    bug: arg.presentation<Bug>("bug"),
    severity: arg.number({ min: 1, max: 3, integer: true }),
  },
  run: ({ bug, severity }, api) => {
    api.snapshotUndo(world.store);
    world.store.update((s) => ({ ...s,
      bugs: s.bugs.map((b) => b.id === bug.id
        ? { ...b, severity: severity as Bug["severity"] } : b) }));
    api.print(bugPart(bug), ` severity set to ${severity}.`);
  },
});

c.define({
  name: "File Bug",
  global: true,                                 // background menu + command line
  args: { title: arg.text({ prompt: "the bug title" }) },
  run: ({ title }, api) => {
    api.snapshotUndo(world.store);
    const bug: Bug = { id: `bug-${Date.now() % 10000}`, title,
                       severity: 2, status: "open", assignee: null };
    world.store.update((s) => ({ ...s, bugs: [...s.bugs, bug], selectedBugId: bug.id }));
    api.print("Filed ", bugPart(bug), ".");
  },
});
```

Walk through what each declaration buys, because none of it will have any other code behind it:

- `args` is an object whose **key order is the collection order** and whose keys are the names shown in prompts and echo lines. `run`'s parameter type is derived from it — `bug: Bug`, `dev: Dev`, `severity: number`, already looked up and unwrapped. There is no argument-handling code to write and none to get wrong.
- `isDefaultFor: ["bug"]` makes *Show Bug* the left-click action of every bug presentation everywhere — table rows, listener mentions, anywhere a bug appears.
- `appliesTo` makes menus state-sensitive: a fixed bug's right-click menu simply will not contain *Assign Bug*. You never write menu code.
- `arg.number({min, max, integer})` compiles into validation with generated messages; out-of-range typed input is rejected at the prompt and the question keeps waiting.
- `api.snapshotUndo(world.store)` is the entire undo integration for a command. Place it after any guard clause that might refuse the command and before the first mutation.
- `global: true` moves a command off object menus and onto the background right-click menu (and the typed command line) — right for commands that are not *about* one visible thing.

> **Checkpoint.** This is testable before any UI exists. Construct the engine (next section) in a vitest file, call `engine.submitCommandLine("file bug something broke")`, and assert the transcript contains "Filed". The demos' `packages/core` tests show the pattern.

## 5. The engine

The **engine** is the framework's interpreter: it owns the input-context state machine, gesture routing, menu computation, the transcript, the command history, and keyboard focus. Constructing it ties together everything you have made so far:

```ts
import { PbuiEngine, installUndoCommands } from "@go-go-golems/pbui-core";

const engine = new PbuiEngine<World>({
  ptypes, commands, world, resolver,
  idleDoc: "Hover a bug. L: Show; M: Describe; R: menu. Try: assign bug bug-1 ada",
});
installUndoCommands(engine);   // the Undo command + right-click-to-undo on history
```

`idleDoc` is the sentence the bottom documentation bar shows when the pointer is over nothing — treat it as your application's one-line help.

You will rarely call the engine directly from application code — commands talk to the world, and views talk to the engine through the wrapper component — but two methods are useful at the edges: `engine.startCommand(name)` runs a command programmatically (a boot message, a toolbar button), and `engine.print(...)` emits application-level output.

Wrap construction in one function so the shell (Section 7) can build everything in a single `useMemo`:

```ts
export function makeEverything() {
  const world = makeWorld();
  const { ptypes, commands, resolver, engine } = /* the code above */;
  return { engine, world };
}
```

## 6. Views: rendering is registering

A view renders domain objects wrapped in `<Presentation>`. The wrapper does two jobs at once: it registers "this region presents bug-1, as a BUG" for the component's lifetime, and it attaches the complete gesture protocol — hover, clicks, right-click, keyboard. That is the entire render-side API:

```tsx
import { Presentation } from "@go-go-golems/pbui-react";
import { Pane } from "@go-go-golems/pbui-chrome";
import { useStore } from "./lib/store";

function BugList({ world }: { world: World }) {
  const s = useStore(world.store);
  return (
    <Pane title="Bugs" subtitle={`${s.bugs.length} filed`} style={{ flex: 2 }}>
      <table>
        <tbody>
          {s.bugs.map((b) => (
            <tr key={b.id} style={b.id === s.selectedBugId ? { outline: "2px solid var(--pbui-ink)" } : {}}>
              <td>
                <Presentation type="bug" object={{ kind: "bug", id: b.id }} label={b.id}>
                  {b.title}
                </Presentation>
              </td>
              <td>sev {b.severity}</td>
              <td>
                {b.assignee && (
                  <Presentation type="dev" object={{ kind: "dev", id: b.assignee }} label={world.dev(b.assignee)!.name}>
                    {world.dev(b.assignee)!.name}
                  </Presentation>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Pane>
  );
}
```

Note what the wrapper takes: the ptype, the reference (`object=`), and a `label` — the short name used in echo lines, menus, and the doc bar. The children are whatever you want drawn; label and children often differ (here the label is the id, the visible text is the title).

The one rule of this section: **do not add `onClick` handlers to presentations.** The wrapper already routes every gesture through the engine, and a hand-wired handler would bypass the input context — the click that should answer "which bug?" would open a record instead. If you need a new behavior, it is a command.

> **Checkpoint.** Nothing renders yet without the shell, but the piece is done when it compiles: every bug row wraps its title, every assignee name wraps in a dev presentation.

## 7. The shell

The shell composes the standard furniture — the **listener** (output area plus typed input), the **context-menu host**, the **doc bar**, and the **status line** — around your panes. Copy this shape; every demo uses it:

```tsx
import { useEffect, useMemo, useRef } from "react";
import { PbuiProvider, usePbuiSurface } from "@go-go-golems/pbui-react";
import { ContextMenuHost, MouseDocBar, StatusLine, Pane, ActivityPane } from "@go-go-golems/pbui-chrome";
import { Listener } from "@go-go-golems/pbui-listener";

function TrackerApp({ engine, world }) {
  const surface = usePbuiSurface();   // background right-click → global menu
  const booted = useRef(false);
  useEffect(() => {                    // StrictMode-safe boot message
    if (booted.current) return;
    booted.current = true;
    engine.print("BUG TRACKER — right-click a bug; try Assign Bug. Type `file bug <title>` to add one.");
  }, [engine]);

  return (
    <div className="pbui-root" style={{ height: "100vh", display: "flex", flexDirection: "column" }} {...surface}>
      <div style={{ display: "flex", gap: 8, padding: 8, flex: 2, minHeight: 0 }}>
        <BugList world={world} />
        <ActivityPane limit={10} />
      </div>
      <div style={{ display: "flex", padding: "0 8px 8px", flex: 1, minHeight: 130 }}>
        <Pane title="Listener" style={{ flex: 1 }} bodyStyle={{ padding: 0, display: "flex" }}>
          <Listener style={{ flex: 1 }} prompt="TRACKER> " />
        </Pane>
      </div>
      <ContextMenuHost />
      <MouseDocBar right="TRACKER" />
      <StatusLine user="you" pkg="TRACKER" />
    </div>
  );
}

export default function App() {
  const { engine, world } = useMemo(() => makeEverything(), []);
  return <PbuiProvider engine={engine}><TrackerApp engine={engine} world={world} /></PbuiProvider>;
}
```

Three details that repay attention: `usePbuiSurface()` spread on the root is what gives empty space its right-click menu and clears hover state when the pointer leaves everything; the `booted` ref guards the boot message against React StrictMode's double-mounted effects in development; and `className="pbui-root"` is where the theme attaches — without it you get unstyled structure.

## 8. Run it, and what you now have

Start your dev server and open the app.

> **Checkpoint.** You should see the monochrome layout from the sketch at the top of this guide: bordered panes with uppercase titles, your boot message in the listener, a black doc bar at the bottom showing your `idleDoc` sentence, and the status line reading `User Input`.

Now walk this list. Every behavior derives from the declarations above; none has dedicated code.

1. **Hover** any bug: the doc bar shows its printed form and the gesture affordances — `#<BUG bug-2 "slow search" sev2> — L: Show Bug; M: Describe; R: menu of 3 commands.`
2. **Right-click** a bug: a menu of exactly the applicable commands. Mark a bug fixed in your seed data and confirm its menu lacks *Assign Bug* — that is `appliesTo` answering.
3. **Pick *Assign Bug …***: the screen partitions. Every DEV presentation grows an animated dashed outline (the "marching ants"); everything else dims; the status line reads `Accept DEV`; the prompt shows the pending question. Click a dev — or type a name prefix — and the command completes, narrating itself.
4. **Click the bug's id inside that output line**: it is a real presentation; *Show Bug* runs and the row highlights.
5. **Type `undo`**: the assignment reverts — status and assignee together, because the snapshot restores the whole pre-command state. Right-clicking the `Command: Assign Bug` line in the listener offers the same. The Activity pane shows the history with status glyphs.
6. **Put the mouse away**: press Tab until a presentation shows a double outline, move with the arrow keys, press Enter to click, `m` for its menu (type a letter to jump to an item), `d` to describe. Start *Assign Bug* and press Tab — it cycles through only the eligible developers.
7. **Use the command line**: `assign bug bug-1 ada`, `set severity bug-2 1`, `file bug dark mode flickers` — command names prefix-match, arguments go through the same parsers and validators as clicks.

## 9. When something looks wrong

The first-run mistakes are few and have distinctive symptoms:

| Symptom | Cause |
|---|---|
| Everything renders as unstyled black-on-white text, no outlines anywhere | the theme CSS import is missing, or `className="pbui-root"` is not on the root element |
| Hovering shows outlines but the doc bar never changes | `<MouseDocBar />` is not mounted, or it is outside the `PbuiProvider` |
| Right-clicking empty space shows the browser's own menu | the root element is missing the `{...usePbuiSurface()}` spread |
| Clicking a presentation does something custom instead of supplying an argument mid-command | an `onClick` was added to a presentation — remove it; make the behavior a command |
| Typing at the prompt during an accept always errors | the pending ptype has no `parse`; add one (Section 2) |
| `undo` prints "Unknown command" | `installUndoCommands(engine)` was never called |
| The boot message appears twice in development | the `booted` ref guard is missing (StrictMode double-runs effects) |
| A command silently does nothing from a menu | its `appliesTo` returned false — check it against the object you clicked |

## 10. Where to go next

- **`docs/user-guide.md`** — the textbook: the model this pattern comes from, and each mechanism you just used (registry, accept loop, participation modes, output records, the performance rules) explained with the reasoning underneath. Start with its Chapter 2 vocabulary and Chapter 10, "Anatomy of a gesture," which traces the *Assign Bug* click you just performed through every module.
- **`docs/api-reference.md`** — exact signatures and contracts for every export.
- **`apps/demos/`** — seven worked examples in increasing sophistication; the README there gives a reading order. When your application needs something this tutorial didn't cover — SVG presentations, clicks on a drawing canvas, coercions, live-ticking data, tabs that stay usable mid-command — one of the demos already does it, and its file header says which.

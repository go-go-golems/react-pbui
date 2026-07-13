# Getting Started with @pbui

This guide builds a small, complete presentation-based application — a bug tracker — from an empty file. By the end you will understand the five things every @pbui application consists of: a world, presentation types, commands, an engine, and views that register what they present. More importantly, you will understand *why* the pieces divide this way, because the division is what buys you the behavior you never write: context menus, argument collection, keyboard operation, and an undo-capable command history all derive from declarations you are about to make.

If you have not seen a presentation-based UI before, run the demos first (`pnpm demos`, then open Hello PBUI) and try the herald's suggestions. The pattern is easier to build once you have felt it: hover something and watch the bottom bar; right-click it; start a two-argument command and watch the screen partition into things-that-answer-the-question and everything else.

## 0. Setup

Inside this monorepo, a new app is a directory under `apps/` with the workspace packages as dependencies:

```jsonc
// package.json (dependencies)
{
  "@pbui/core": "workspace:*",
  "@pbui/react": "workspace:*",
  "@pbui/listener": "workspace:*",
  "@pbui/chrome": "workspace:*",
  "@pbui/theme-genera": "workspace:*",
  "react": "^18.3.1", "react-dom": "^18.3.1"
}
```

The packages export TypeScript source directly (`main: src/index.ts`), so any Vite-style bundler consumes them without a build step. Import the theme once, at your entry point:

```ts
import "@pbui/theme-genera/genera.css";
```

## 1. The world

The world is your domain state plus the view state that commands need to manipulate. It is plain TypeScript — @pbui imposes nothing on it except one convention: update it immutably, because snapshot undo (Section 7) works by remembering previous state objects.

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

// a ~30-line subscribable store; copy apps/demos/src/lib/store.ts
export class Store<T> { get(): T; set(next: T): void; update(fn: (s: T) => T): void; subscribe(fn): () => void }

export interface World {
  store: Store<TrackerState>;
  bug(id: string): Bug | undefined;
  dev(id: string): Dev | undefined;
}
```

Why does view state (`selectedBugId`) live in the world rather than in a React component? Because selection should be a *command effect*. When "Show Bug" is a command, it appears in menus, works from the keyboard and the command line, narrates itself to the transcript, and shows up in the command history — none of which happens to a `useState` setter.

## 2. Presentation types

A presentation type names a kind of thing that can appear on screen, and it carries the four capabilities the engine will exercise on your behalf: printing, parsing, describing, and a default action.

```ts
import { PTypes, defineBuiltinPtypes } from "@pbui/core";

const ptypes = new PTypes<World>();
defineBuiltinPtypes(ptypes);        // registers "number" and "string"

ptypes.define<Bug>({
  name: "bug",
  print: (b) => `#<BUG ${b.id} "${b.title}" sev${b.severity}>`,
  describe: (b, w) => [
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
  parse: (text, w) => { /* name prefix match, same shape */ },
});
```

Two things to internalize here:

- **`parse` is not optional in spirit.** It is the keyboard half of argument collection. When a command asks for a BUG, the user can click any bug presentation *or* type `bug-7` at the prompt; both paths go through the same validation. The convention — accept prefixes, return one canonical `label` — is the "recognizer tolerance" the pattern requires: the system prints one form, the user may type several.
- **`print` will never be called with `undefined`.** The engine resolves objects before printing and falls back to a generic form for stale references. Write printers that dereference confidently.

## 3. The resolver

Presentations never hold your objects; they hold references (`{kind: "bug", id: "bug-7"}`). The resolver is the one function that turns references back into live objects — and `undefined` is a meaningful answer:

```ts
import type { Resolver } from "@pbui/core";

const resolver: Resolver = {
  resolve: (ref) => {
    if (!("id" in ref)) return undefined;
    if (ref.kind === "bug") return world.bug(ref.id);
    if (ref.kind === "dev") return world.dev(ref.id);
    return undefined;
  },
};
```

This indirection is what lets a bug's name, printed to the transcript ten commands ago, still work after the bug list has been refetched, resorted, or partially deleted. When the object is gone, the engine aborts the command with one standardized message; your command bodies never see a stale object.

## 4. Commands

Commands are where the application's behavior lives, and the typed builder is the authoring surface. Read this one carefully — most of the library's value is visible in it:

```ts
import { CommandTable, commandBuilder, arg, valueRef } from "@pbui/core";

const commands = new CommandTable<World>();
const c = commandBuilder(commands);

c.define({
  name: "Show Bug",
  args: { bug: arg.presentation<Bug>("bug") },
  isDefaultFor: ["bug"],                       // left-click on any bug
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
    /* ... */
    api.print(bugPart(bug), ` severity set to ${severity}.`);
  },
});

c.define({
  name: "File Bug",
  global: true,                                 // background menu + command line
  args: { title: arg.text({ prompt: "the bug title" }) },
  run: ({ title }, api) => { /* create, select, narrate */ },
});
```

Walk through what each declaration buys:

- `args` is an object whose **key order is the accept order** and whose keys are the display names in prompts and echoes. `run`'s parameter type is derived from it — `bug: Bug`, `dev: Dev`, `severity: number`, already resolved and unwrapped. There is no argument-handling code to write and none to get wrong.
- `isDefaultFor: ["bug"]` makes *Show Bug* the left-click action of every bug presentation everywhere — table rows, transcript mentions, anywhere a bug is rendered.
- `appliesTo` makes menus state-sensitive: a fixed bug's right-click menu simply does not contain *Assign Bug*. You will never write menu code.
- `arg.number({min, max, integer})` compiles to validation with generated messages; invalid typed input is rejected at the prompt and the argument keeps waiting.
- `api.snapshotUndo(world.store)` as the first line of a mutating command is the entire undo integration. Put it after any guard clauses that can refuse the command, so refused runs do not register no-op undos.

The part helpers referenced above are one-liners you write per entity type; they are what keeps transcript output alive:

```ts
const bugPart = (b: Bug) => ({ t: "pres", type: "bug", ref: { kind: "bug", id: b.id }, label: b.id }) as const;
```

## 5. The engine

```ts
import { PbuiEngine, installUndoCommands } from "@pbui/core";

const engine = new PbuiEngine<World>({
  ptypes, commands, world, resolver,
  idleDoc: "Hover a bug. L: Show; M: Describe; R: menu. Try: assign bug bug-1 ada",
});
installUndoCommands(engine);   // Undo command, invocation ptype, Undo Invocation
```

The engine is the recognizer: it owns the accept-loop state machine, gesture routing, menu derivation, the transcript, the invocation log, and keyboard focus. You will rarely call it directly from application code — commands talk to the world, views talk to the registry through the hook — but two methods are useful at the edges: `engine.startCommand(name)` to run something programmatically (a boot herald, a toolbar button) and `engine.print(...)` for application-level output.

## 6. Views: rendering is registering

A view renders domain objects wrapped in `<Presentation>`. That is the entire render-side API:

```tsx
import { Presentation } from "@pbui/react";
import { Pane } from "@pbui/chrome";
import { useStore } from "./store";

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

Do not add `onClick` handlers to presentations. The wrapper already routes every gesture through the engine, and hand-wired handlers would bypass the input context — the click that should supply an argument would do something else instead. If you need a new behavior, it is a command.

## 7. The shell

The shell composes the standard chrome around your panes. Copy this shape; every demo uses it:

```tsx
import { PbuiProvider, usePbuiSurface } from "@pbui/react";
import { ContextMenuHost, MouseDocBar, StatusLine, Pane, ActivityPane } from "@pbui/chrome";
import { Listener } from "@pbui/listener";

function TrackerApp({ engine, world }) {
  const surface = usePbuiSurface();   // background right-click -> global menu
  const booted = useRef(false);
  useEffect(() => {                    // StrictMode-safe boot command
    if (booted.current) return;
    booted.current = true;
    engine.print("BUG TRACKER — right-click a bug; try Assign Bug.");
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

## 8. What you now have without having written it

Run the app and walk through this list. Every item derives from the declarations above; none of it has dedicated code.

- Hover any bug: the bottom bar shows its printed form and the gesture affordances (`L: Show Bug; M: Describe; R: menu of 3 commands`).
- Right-click a bug: a menu of exactly the applicable commands — and a fixed bug's menu lacks *Assign Bug*, because `appliesTo` said so.
- Pick *Assign Bug …*: the screen partitions. Every DEV presentation grows a marching-ants outline; everything else dims. The status line reads `Accept DEV`. Click a dev — or type a name prefix at the prompt — and the command completes, narrating itself with live parts.
- Click the bug's id inside that transcript line: it is a real presentation; *Show Bug* runs.
- Type `undo`: the assignment reverts (status and assignee together, because the snapshot restores the pre-command state). Right-clicking the echo line offers the same.
- Put the mouse away: Tab reaches a presentation (double outline), arrows move, Enter clicks, `m` opens the menu with type-ahead, and during an accept Tab cycles only the eligible presentations.
- The command line at the prompt: `assign bug bug-1 ada` — prefix-matched command name, positional arguments through the same parsers and validators.

## 9. Where to go next

- **`docs/user-guide.md`** — the concepts underneath what you just built: the registry, the accept loop's mechanics, participation modes, output records, the render-cost model, and how the packages relate.
- **`docs/api-reference.md`** — exact signatures and contracts for every export.
- **`apps/demos/`** — seven worked examples in increasing sophistication; the README there gives a reading order. When your application needs something these patterns don't cover (SVG hit rects, canvas presentations, location accepts, coercions), one of the demos already does it.

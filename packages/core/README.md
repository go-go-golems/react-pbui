# @pbui/core

This package is the interaction engine for presentation-based UIs, and it has no dependencies — not even React. Everything that gives the paradigm its semantics lives here: the presentation-type lattice, the presentation registry, command tables, the accept loop, undo, and the transcript. The React packages are thin bindings over this one, which is why the entire engine can be unit-tested in Node and why the same engine drives HTML, SVG, and canvas renderers.

The design premise is that a UI framework's render tree records *how to draw*, not *what is meant*. This package maintains the meaning: a queryable store of which domain objects are on screen, under which types, and a state machine that interprets gestures against that store.

## The five ideas

1. A **ptype** (`PTypes.define`) is a named node in a subtype lattice carrying a printer, a keyboard parser, a describer, and optionally a default command. Printer and parser form a round-trip codec: what the system prints, the user can type back.
2. An **ObjectRef** (`{kind, id}` or `valueRef(x)`) is how presentations refer to domain objects without holding them. Your `Resolver` turns refs back into objects; `undefined` means the object is gone, and the engine handles that centrally.
3. The **PresentationRegistry** is the presentation database: every on-screen presentation registers a record, and the registry answers "which presentations of object X exist right now" (`byRef`), "which presentations of type T" (`byType`), and "what is at this point" (`at`). It is also the render-invalidation channel (`subscribePres`).
4. A **command** declares typed arguments. Executing one with unfilled arguments starts an **input context**: eligible presentations highlight, everything else gates, and clicking, typing, or menu-choosing supplies the value. The `commandBuilder` gives this a fully typed authoring surface — `run` receives resolved domain objects, never refs.
5. **Output records** are transcript lines built from typed parts; a `pres` part stays a live presentation forever, so printed objects can answer later commands' questions.

## Minimal use (no React)

```ts
import {
  PTypes, defineBuiltinPtypes, CommandTable, commandBuilder, arg,
  PbuiEngine, installUndoCommands, renderTranscript, type Resolver,
} from "@pbui/core";

const ptypes = new PTypes<World>();
defineBuiltinPtypes(ptypes);                       // "number", "string"
ptypes.define<Ship>({
  name: "ship",
  print: (s) => `#<SHIP ${s.name}>`,
  parse: (text, w) => /* name prefix -> {ok, value, ref, label} */,
});

const commands = new CommandTable<World>();
const c = commandBuilder(commands);
c.define({
  name: "Refuel Ship",
  args: { ship: arg.presentation<Ship>("ship") },
  run: ({ ship }, api) => {
    api.snapshotUndo(world.store);                 // one-line undo opt-in
    api.print(`Refuelled ${ship.name}.`);          // ship: Ship, resolved
  },
});

const engine = new PbuiEngine({ ptypes, commands, world, resolver });
installUndoCommands(engine);

engine.startCommand("Refuel Ship", somePresentationRecord);
console.log(renderTranscript(engine.transcript.lines()));
// [echo] **Command:** Refuel Ship (ship) AURORA
// [out ] Refuelled AURORA.
```

The engine is driven entirely through methods (`gesture`, `startCommand`, `submitTyped`, `escape`, `undoInvocation`) and observed through subscriptions (`subscribe`, `registry.subscribePres`, `transcript.subscribe`, `invocations.subscribe`) — which is exactly how the tests exercise it and how `@pbui/react` binds it.

## Key exports

| Export | Role |
|---|---|
| `PTypes`, `defineBuiltinPtypes` | type lattice + print/parse codecs |
| `PresentationRegistry` | the presentation database + invalidation channel |
| `CommandTable`, `commandBuilder`, `arg` | commands as data; typed authoring |
| `PbuiEngine` | gestures, accept loop, menus, coercions, focus |
| `InvocationLog`, `installUndoCommands` | command history, linear undo |
| `Transcript`, `S`/`B`/`E`/`P`, `renderTranscript` | output records + the golden-tested text form |
| `pointerDoc`, `modeLabel` | pure derivations for the doc/status lines |

## Contracts worth knowing before you build

- Printers never receive `undefined`; the doc line and describe resolve first and fall back to a generic `#<TYPE label>` form.
- The echo grammar (`renderTranscript` output) is pinned by golden tests. Treat it as a specification.
- `duringAccept` commands must be seed-complete (at most one presentation argument); `CommandTable.define` throws otherwise.
- Undo is linear-only; `snapshotUndo` restores the *whole* store, including unrelated concurrent mutations — prefer `api.undoable` with an explicit inverse in live-ticking worlds.
- `where`/`validate` predicates run eagerly for every candidate presentation on each accept transition. Keep them cheap and pure.

Deeper material: `docs/getting-started.md`, `docs/user-guide.md`, `docs/api-reference.md` at the repository root.

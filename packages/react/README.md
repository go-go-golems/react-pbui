# @pbui/react

This package binds a `@pbui/core` engine to React. It is deliberately small, because the division of labor is strict: the engine owns every interaction semantic (what a click means, what is eligible, what the menu contains), and React owns rendering. The binding's job is to register what each component presents, route DOM gestures into the engine, and re-render exactly the components whose presentation flags changed.

## What a presentation is, in React terms

Wrapping rendered content in `<Presentation>` registers a record in the engine's registry for the component's lifetime and attaches the full gesture protocol:

```tsx
import { PbuiProvider, Presentation, usePbuiSurface } from "@pbui/react";

<Presentation type="customer" object={{ kind: "customer", id: c.id }} label={c.name}>
  {c.name}
</Presentation>
```

From that one wrapper the customer name acquires: a hover outline and doc-line entry, a right-click menu of exactly the commands applicable to CUSTOMERs (state-sensitively), a left-click default command, middle-click describe, keyboard reachability (roving focus, Enter, `m`, `d`), and eligibility during input contexts — it will grow a marching-ants outline whenever some command is asking for a CUSTOMER, and clicking it then supplies the argument.

`<SvgPresentation>` is the same protocol for SVG (`<g>` wrapper, an optional invisible `hitRect`, ring-rect highlights, since SVG has no CSS outline). Both are sugar over the headless `usePresentation` hook, which returns the gesture props and the state flags for cases where you render the element yourself.

## The shell

```tsx
function App({ engine }) {
  const surface = usePbuiSurface();   // background right-click menu, hover clearing
  return (
    <div className="pbui-root" {...surface}>
      <YourPanes />
    </div>
  );
}

<PbuiProvider engine={engine}>   {/* global Escape handling lives here */}
  <App engine={engine} />
</PbuiProvider>
```

## The render-cost model

`usePresentation` subscribes to *its own registry record only* (`registry.subscribePres`), not to engine state. Hover transitions therefore re-render the old target, the new target, and other presentations of the same objects — measured at 1.98 component renders per hover transition with 2,000 presentations mounted. Accept transitions broadcast, because an input context legitimately changes every presentation's flags. If you build your own consumers, follow the same split: `useEngineState()` for chrome that reflects any change (doc bars, status lines), `subscribePres` for anything that scales with presentation count.

## Key exports

| Export | Role |
|---|---|
| `PbuiProvider`, `useEngine` | engine context + global Escape |
| `usePresentation` | the headless primitive: registration + gesture props + flags |
| `Presentation`, `SvgPresentation` | HTML and SVG sugar over the hook |
| `usePbuiSurface` | root-element handlers (background menu, hover clear) |
| `useEngineState`, `useTranscript` | subscriptions for chrome-level components |

## Props that change behavior

- `quiet` — container presentations: menuable and describable, but no hover flash over their contents and never dimmed inert.
- `duringAccept="active" | "fallthrough"` — participation during foreign input contexts: `active` keeps navigation clickable (its default command must be marked `duringAccept` in the command table), `fallthrough` makes decoration gesture-transparent so clicks reach the canvas beneath. The default (`gated`) dims and swallows, and most presentations should keep it.
- `disabled` — render-only: no registration, no gestures.

Deeper material: `docs/getting-started.md` for the tutorial, `docs/user-guide.md` for the concepts, `docs/api-reference.md` for exact signatures.

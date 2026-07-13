# @go-go-golems/pbui-listener

This package renders the interactor: the scrolling transcript of everything commands print, plus the prompt line that doubles as the command line and the typed-argument input. In a presentation-based UI the transcript is not a log — it is an interaction surface. Objects printed to it remain live presentations, and past commands can be undone from their own echo lines. This package is where those properties become visible.

## Use

```tsx
import { Listener } from "@go-go-golems/pbui-listener";

<Pane title="Listener" bodyStyle={{ padding: 0, display: "flex" }}>
  <Listener style={{ flex: 1 }} prompt="SHOP> " />
</Pane>
```

The component subscribes to the engine's transcript, invocation log, and accept state, and renders three things:

1. **Output records.** Each line is an array of typed parts. Text and bold parts render as text; a `pres` part mounts a real `<Presentation>`, so a customer name printed three commands ago still hovers, right-clicks, and supplies arguments. Parts hold refs and resolve at render time, so transcript mentions survive domain changes and degrade explicitly when the object is gone.
2. **Echo lines as command history.** A line that echoes a command is wrapped in a quiet presentation of its *invocation record* — right-click it for `Undo Invocation` (when the command opted into undo and is the most recent undoable one) and `Describe`.
3. **The prompt line**, which morphs by engine state: an idle command line (prefix matching, Tab completion, Up/Down history with draft restore), a typed-argument input showing `(qty: a NUMBER [default 1]) ⇒` during accepts, or a pointing hint when the wanted argument is supplied by clicking.

## How output gets here

Commands print through their api, using strings and part constructors:

```ts
api.print(orderPart(order), " connected to ", B(channel.name), ".");
```

where `orderPart` is an app-side helper returning `{t: "pres", type: "order", ref, label}`. If printing an object's name does not produce a live part, the transcript has stopped being part of the interface — build part helpers for every entity type early.

## Accessibility

The newest output line is mirrored into a visually hidden `aria-live="polite"` region, so screen readers hear results without being read the scrollback. The transcript is text-selectable (overriding the theme's global `user-select: none`).

## Key exports

| Export | Role |
|---|---|
| `Listener` | transcript + prompt + command line + history |
| `PartView` | the part renderer, reusable for custom transcript-like surfaces |

Deeper material: `docs/user-guide.md` (output records chapter), `docs/api-reference.md`.

# @pbui/chrome

This package supplies the window furniture every presentation-based application needs and none should rebuild: the context menu, the pointer documentation bar, the status line, pane frames, and the activity (command-history) pane. Each component is a rendering of engine state — the chrome contains no interaction logic of its own, which is why swapping or restyling it cannot change what gestures mean.

## The standard shell

```tsx
import { ContextMenuHost, MouseDocBar, StatusLine, Pane, ActivityPane } from "@pbui/chrome";

<div className="pbui-root" {...surface}>
  <Pane title="Orders" subtitle="12 of 12">{/* your presentations */}</Pane>
  <ContextMenuHost />
  <MouseDocBar right="BACK OFFICE" />
  <StatusLine user="clerk" pkg="SHOP" host="STOREFRONT" />
</div>
```

## What each piece renders

**`ContextMenuHost`** renders `engine.getState().menu` — object menus, the background global menu, choice menus for menu-valued arguments, and the reduced during-accept menus all arrive through the same state, so one host serves every case. It is a keyboard-operable ARIA menu: focus moves in on open and returns to the invoking element on close, arrows wrap, Home/End jump, Enter/Space activate, printable keys type-ahead, and every menu ends in the Abort footer. Position is clamped to the viewport after measuring.

**`MouseDocBar`** renders `pointerDoc(engine)`, the pure derivation of (input context, hovered-or-focused presentation): what the mouse buttons would do right now, what a pending command is waiting for, why the thing under the pointer is not applicable. The bar is a polite live region (`role="status"`), which makes the doc line the screen reader's narration of the interface for free.

**`StatusLine`** renders the Genera-style strip — clock, user, package, and the interaction mode from `modeLabel(engine)`: `User Input`, `Accept TASK`, or `Menu Choose`. The mode label is the fastest way to see that an input context is active.

**`Pane`** is the bordered frame with an uppercase title, optional subtitle, and an `extra` slot — the visual unit every demo composes its layout from.

**`ActivityPane`** renders the invocation log as live INVOCATION presentations with status glyphs (`…` executing, `✓` completed, `✕` failed, `↩` undone). Right-clicking an entry offers `Undo Invocation` when applicable. Requires `installUndoCommands(engine)` to have been called.

## Key exports

| Export | Role |
|---|---|
| `ContextMenuHost` | the one menu host (ARIA menu, type-ahead, clamping, Abort) |
| `MouseDocBar` | doc line = derivation + live region |
| `StatusLine` | clock / user / mode strip |
| `Pane` | bordered titled frame |
| `ActivityPane` | command history as presentations |

Styling comes entirely from `@pbui/theme-genera` class names (`pbui-menu`, `pbui-docbar`, `pbui-pane`, …); the components emit structure, not appearance.

Deeper material: `docs/user-guide.md`, `docs/api-reference.md`.

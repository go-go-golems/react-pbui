# @pbui/theme-genera

This package is a stylesheet, and the stylesheet is a contract. The @pbui components emit structure and class names; every visual decision — what "eligible" looks like, what "inert" looks like, what a menu looks like — lives here as CSS. The shipped look is the monochrome Symbolics Genera / Dynamic Windows aesthetic: ink on paper, monospace, hard borders, marching-ants dashes, inverse-video bars. An alternative theme is an alternative stylesheet implementing the same class vocabulary.

## Use

```ts
import "@pbui/theme-genera/genera.css";
```

and put `className="pbui-root"` on your application's outermost element.

## The state classes (the part that is really API)

These class names are applied by `usePresentation` and asserted by the end-to-end test suite; a replacement theme must style all of them, and renaming them is a breaking change.

| Class | Meaning | Genera rendering |
|---|---|---|
| `pbui-pres` | any presentation | transparent 2px outline (reserves space) |
| `pbui-hover` | pointer is on this presentation | solid outline |
| `pbui-related` | another presentation of the same object is hovered | dotted outline |
| `pbui-eligible` | matches the pending argument — clicking supplies it | dashed marching-ants animation |
| `pbui-inert` | an input context is active and this does not match | 0.3 opacity, `pointer-events: none` |
| `pbui-passthru` | fallthrough mode during a foreign accept | `pointer-events: none`, no dimming |
| `pbui-kbd-target` | the keyboard focus cursor | double outline |

Chrome classes (`pbui-menu*`, `pbui-docbar*`, `pbui-status*`, `pbui-pane*`, `pbui-listener*`, `pbui-line*`, `pbui-prompt*`) style the components from `@pbui/chrome` and `@pbui/listener`.

## Tokens

```css
:root {
  --pbui-ink;  --pbui-paper;  --pbui-desk;          /* the monochrome base */
  --pbui-teal; --pbui-coral;  --pbui-gold;          /* text-only accents   */
  --pbui-font; --pbui-font-size;
}
```

The design rule inherited from the source prototypes: chrome stays monochrome; accent colors appear only on content text (status glyphs, semantic markers), never on borders or backgrounds. Demos use the accent variables for things like order-status glyphs.

## Behavioral CSS worth knowing

- `pbui-inert`'s `pointer-events: none` is not decoration — it is half of the input context's gating (the engine's click gate is the other half).
- `pbui-passthru` is the entire implementation of fallthrough participation: the DOM delivers the click to whatever is underneath.
- The listener's scroll area restores `user-select: text` inside the globally non-selectable `pbui-root`, so transcripts are copyable.
- `prefers-reduced-motion` disables the marching-ants animation; eligibility remains visible through the dashed outline itself.

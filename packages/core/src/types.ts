/* Shared core types for the PBUI engine.
 *
 * Presentations hold ObjectRefs (never live objects) and are resolved
 * through a Resolver at gesture/execution time, so stale presentations
 * degrade gracefully (design decision D5).
 */

/** Reference to a domain object. `kind` names the object family, `id` its key.
 * Immediate values (numbers, strings, enum choices) use kind "value". */
export type ObjectRef =
  | { kind: string; id: string }
  | { kind: "value"; value: unknown };

export function valueRef(value: unknown): ObjectRef {
  return { kind: "value", value };
}

export function refEquals(a: ObjectRef, b: ObjectRef): boolean {
  if ("value" in a && "value" in b) return a.value === b.value;
  if ("id" in a && "id" in b) return a.kind === b.kind && a.id === b.id;
  return false;
}

/** Apps supply a resolver from refs to live domain objects.
 * `undefined` means the object no longer exists (stale presentation). */
export interface Resolver {
  resolve(ref: ObjectRef): unknown | undefined;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PresId = string;

/** A presentation: a typed, on-screen (or in-transcript) handle to a domain
 * object. This is the record stored in the PresentationRegistry — the
 * thesis's "presentation data base". */
export interface PresentationRecord {
  id: PresId;
  /** ptype name */
  type: string;
  ref: ObjectRef;
  /** display label used in echoes, menus and the mouse-doc line */
  label: string;
  paneId?: string;
  parentId?: PresId;
  /** participation during a foreign input context (CLIM-JSX-005 §5):
   *  gated (default) — dimmed and swallowed; active — stays interactive,
   *  left-click may run a duringAccept command without aborting the
   *  context; fallthrough — gesture-transparent (canvas overlays) */
  mode?: "gated" | "active" | "fallthrough";
  /** lazily measured screen bounds; null/undefined = not hit-testable */
  bounds?: () => Rect | null;
}

/** The subset of a presentation needed to supply/echo an argument.
 * Argument values collected by the accept loop are stored in this shape,
 * whether they came from a click, the keyboard, or a menu. */
export interface ArgValue {
  type: string;
  ref: ObjectRef;
  label: string;
}

export type ArgValues = Record<string, ArgValue>;

/* ----------------------------- output records ---------------------------- */

export type OutputPart =
  | { t: "text"; s: string }
  | { t: "bold"; s: string }
  | { t: "err"; s: string }
  /** a live presentation embedded in transcript output — stays sensitive */
  | { t: "pres"; type: string; ref: ObjectRef; label: string };

export type OutputKind = "out" | "echo" | "err";

export interface OutputRecord {
  id: string;
  kind: OutputKind;
  parts: OutputPart[];
}

/** Loose input accepted by print helpers: strings become text parts. */
export type PartLike = OutputPart | string;

export function toPart(p: PartLike): OutputPart {
  return typeof p === "string" ? { t: "text", s: p } : p;
}

/* part constructors, named after the scheduler's S/B/TASKREF algebra */
export const S = (s: string): OutputPart => ({ t: "text", s });
export const B = (s: string): OutputPart => ({ t: "bold", s });
export const E = (s: string): OutputPart => ({ t: "err", s });
export const P = (type: string, ref: ObjectRef, label: string): OutputPart => ({
  t: "pres",
  type,
  ref,
  label,
});

export type Unsubscribe = () => void;

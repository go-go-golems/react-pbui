/* The PresentationRegistry — the thesis's "presentation data base" (D2).
 *
 * A subscribable store of every presentation currently on screen (or in the
 * transcript). Presenters register on mount and unregister on unmount;
 * consumers query by object ref, by ptype, or by screen point.
 */

import type {
  ObjectRef,
  PresentationRecord,
  PresId,
  Rect,
  Unsubscribe,
} from "./types.js";
import { refEquals } from "./types.js";

export type RegistryEvent =
  | { kind: "register"; rec: PresentationRecord }
  | { kind: "update"; rec: PresentationRecord }
  | { kind: "unregister"; id: PresId };

let nextId = 1;

export class PresentationRegistry {
  private recs = new Map<PresId, PresentationRecord>();
  private listeners = new Set<(ev: RegistryEvent) => void>();

  register(rec: Omit<PresentationRecord, "id">): PresId {
    const id = `p${nextId++}`;
    const full: PresentationRecord = { ...rec, id };
    this.recs.set(id, full);
    this.emit({ kind: "register", rec: full });
    return id;
  }

  update(id: PresId, patch: Partial<Omit<PresentationRecord, "id">>): void {
    const cur = this.recs.get(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    this.recs.set(id, next);
    this.emit({ kind: "update", rec: next });
  }

  unregister(id: PresId): void {
    if (this.recs.delete(id)) this.emit({ kind: "unregister", id });
  }

  get(id: PresId): PresentationRecord | undefined {
    return this.recs.get(id);
  }

  all(): PresentationRecord[] {
    return [...this.recs.values()];
  }

  /** every presentation of the given object — cross-pane highlighting */
  byRef(ref: ObjectRef): PresentationRecord[] {
    return this.all().filter((r) => refEquals(r.ref, ref));
  }

  byType(type: string): PresentationRecord[] {
    return this.all().filter((r) => r.type === type);
  }

  /** smallest hit-testable presentation containing the point */
  at(x: number, y: number): PresentationRecord | undefined {
    let best: PresentationRecord | undefined;
    let bestArea = Infinity;
    for (const r of this.recs.values()) {
      const b = r.bounds?.();
      if (!b) continue;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        const area = b.w * b.h;
        if (area < bestArea) {
          bestArea = area;
          best = r;
        }
      }
    }
    return best;
  }

  subscribe(fn: (ev: RegistryEvent) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(ev: RegistryEvent): void {
    for (const fn of this.listeners) fn(ev);
  }
}

export type { Rect };

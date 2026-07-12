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


export type RegistryEvent =
  | { kind: "register"; rec: PresentationRecord }
  | { kind: "update"; rec: PresentationRecord }
  | { kind: "unregister"; id: PresId };

let nextId = 1;

export function refKey(r: ObjectRef): string {
  return "value" in r ? `v:${String(r.value)}` : `${r.kind}:${r.id}`;
}

export class PresentationRegistry {
  private recs = new Map<PresId, PresentationRecord>();
  private listeners = new Set<(ev: RegistryEvent) => void>();
  /* per-presentation invalidation channel (CLIM-JSX-005 §6.2): hover-paced
   * flag changes notify exactly the affected presentations */
  private presListeners = new Map<PresId, Set<() => void>>();
  private presVersions = new Map<PresId, number>();
  /* refKey -> ids index so byRef is O(presentations-of-that-object) */
  private byRefIdx = new Map<string, Set<PresId>>();

  /** bump one presentation's flag version and wake its subscribers */
  notifyPres(id: PresId): void {
    this.presVersions.set(id, (this.presVersions.get(id) ?? 0) + 1);
    const set = this.presListeners.get(id);
    if (set) for (const fn of set) fn();
  }

  /** accept transitions legitimately change everyone's flags (D3) */
  notifyAllPres(): void {
    for (const id of this.recs.keys()) this.notifyPres(id);
  }

  subscribePres(id: PresId, fn: () => void): Unsubscribe {
    let set = this.presListeners.get(id);
    if (!set) {
      set = new Set();
      this.presListeners.set(id, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.presListeners.delete(id);
    };
  }

  presVersion(id: PresId): number {
    return this.presVersions.get(id) ?? 0;
  }

  register(rec: Omit<PresentationRecord, "id">): PresId {
    const id = `p${nextId++}`;
    const full: PresentationRecord = { ...rec, id };
    this.recs.set(id, full);
    this.indexRef(full);
    this.emit({ kind: "register", rec: full });
    return id;
  }

  private indexRef(rec: PresentationRecord): void {
    const k = refKey(rec.ref);
    let set = this.byRefIdx.get(k);
    if (!set) {
      set = new Set();
      this.byRefIdx.set(k, set);
    }
    set.add(rec.id);
  }

  private unindexRef(rec: PresentationRecord): void {
    const k = refKey(rec.ref);
    const set = this.byRefIdx.get(k);
    if (set) {
      set.delete(rec.id);
      if (set.size === 0) this.byRefIdx.delete(k);
    }
  }

  update(id: PresId, patch: Partial<Omit<PresentationRecord, "id">>): void {
    const cur = this.recs.get(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    this.unindexRef(cur);
    this.recs.set(id, next);
    this.indexRef(next);
    this.emit({ kind: "update", rec: next });
  }

  unregister(id: PresId): void {
    const cur = this.recs.get(id);
    if (!cur) return;
    this.recs.delete(id);
    this.unindexRef(cur);
    this.presListeners.delete(id);
    this.presVersions.delete(id);
    this.emit({ kind: "unregister", id });
  }

  get(id: PresId): PresentationRecord | undefined {
    return this.recs.get(id);
  }

  all(): PresentationRecord[] {
    return [...this.recs.values()];
  }

  /** every presentation of the given object — cross-pane highlighting */
  byRef(ref: ObjectRef): PresentationRecord[] {
    const ids = this.byRefIdx.get(refKey(ref));
    if (!ids) return [];
    const out: PresentationRecord[] = [];
    for (const id of ids) {
      const r = this.recs.get(id);
      if (r) out.push(r);
    }
    return out;
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

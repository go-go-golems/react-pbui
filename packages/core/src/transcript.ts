/* The transcript: a capped, subscribable list of output records whose
 * object parts remain live presentations (D7). */

import type {
  OutputKind,
  OutputRecord,
  PartLike,
  Unsubscribe,
} from "./types.js";
import { toPart } from "./types.js";

let nextLineId = 1;

export class Transcript {
  private records: OutputRecord[] = [];
  private listeners = new Set<() => void>();

  constructor(private cap = 300) {}

  print(kind: OutputKind, ...parts: PartLike[]): OutputRecord {
    const rec: OutputRecord = {
      id: `l${nextLineId++}`,
      kind,
      parts: parts.map(toPart),
    };
    this.records = [...this.records, rec];
    if (this.records.length > this.cap)
      this.records = this.records.slice(this.records.length - this.cap);
    this.emit();
    return rec;
  }

  out(...parts: PartLike[]): OutputRecord {
    return this.print("out", ...parts);
  }
  echo(...parts: PartLike[]): OutputRecord {
    return this.print("echo", ...parts);
  }
  err(...parts: PartLike[]): OutputRecord {
    return this.print("err", ...parts);
  }

  clear(): void {
    this.records = [];
    this.emit();
  }

  /** stable snapshot for useSyncExternalStore */
  lines(): OutputRecord[] {
    return this.records;
  }

  subscribe(fn: () => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

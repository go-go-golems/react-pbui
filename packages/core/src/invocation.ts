/* Command invocation records (CLIM-JSX-004 §7) — the thesis's "command
 * application": every executed command becomes a first-class record with
 * lifecycle state, presentable and (when the command opted in) undoable.
 *
 * Core stays clock-free (decision D5): `seq` orders records; apps map to
 * wall time at display if they want it. Undo is linear-only (decision D4).
 */

import type { ArgValues, Unsubscribe } from "./types.js";

export type InvocationStatus = "executing" | "completed" | "failed" | "undone";

export interface CommandInvocation {
  id: string; // "inv-17"
  name: string; // "Fulfill Order"
  /** args as collected — refs, so records survive world GC */
  argValues: ArgValues;
  status: InvocationStatus;
  error?: string;
  /** present iff the command opted into undo and completed */
  undo?: () => void | Promise<void>;
  /** monotonic ordering */
  seq: number;
  /** transcript echo line this invocation belongs to, if any */
  echoLineId?: string;
}

let nextSeq = 1;

export class InvocationLog {
  private records: CommandInvocation[] = [];
  private listeners = new Set<() => void>();

  constructor(private cap = 100) {}

  record(name: string, argValues: ArgValues, echoLineId?: string): CommandInvocation {
    const seq = nextSeq++;
    const inv: CommandInvocation = {
      id: `inv-${seq}`,
      name,
      argValues,
      status: "executing",
      seq,
      echoLineId,
    };
    this.records = [...this.records, inv];
    if (this.records.length > this.cap)
      this.records = this.records.slice(this.records.length - this.cap);
    this.emit();
    return inv;
  }

  private patch(id: string, p: Partial<CommandInvocation>): void {
    this.records = this.records.map((r) => (r.id === id ? { ...r, ...p } : r));
    this.emit();
  }

  complete(id: string, undo?: () => void | Promise<void>): void {
    this.patch(id, { status: "completed", undo });
  }

  fail(id: string, error: string): void {
    this.patch(id, { status: "failed", error });
  }

  markUndone(id: string): void {
    this.patch(id, { status: "undone", undo: undefined });
  }

  byId(id: string): CommandInvocation | undefined {
    return this.records.find((r) => r.id === id);
  }

  byEchoLine(lineId: string): CommandInvocation | undefined {
    return this.records.find((r) => r.echoLineId === lineId);
  }

  /** the only invocation Undo will touch — linear undo (D4) */
  lastUndoable(): CommandInvocation | undefined {
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i]!;
      if (r.status === "completed" && r.undo) return r;
    }
    return undefined;
  }

  list(): CommandInvocation[] {
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

/* Tiny subscribable store for demo worlds. Commands mutate through the
 * world facade; React reads via useStore (useSyncExternalStore). */

import { useSyncExternalStore } from "react";

export class Store<T> {
  private listeners = new Set<() => void>();

  constructor(private state: T) {}

  get(): T {
    return this.state;
  }

  set(next: T): void {
    this.state = next;
    for (const fn of this.listeners) fn();
  }

  update(fn: (s: T) => T): void {
    this.set(fn(this.state));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.get(),
    () => store.get(),
  );
}

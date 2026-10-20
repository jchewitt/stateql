import {
  assertNotInReactiveContext,
  DestroyRef,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import type { StoreReader } from '@jchewitt/stateql-core';

export interface StateQLSignalOptions {
  /** Defaults to the current injection context's lifetime. */
  readonly destroyRef?: DestroyRef;
}

/**
 * Observe immutable StateQL snapshots without taking ownership of the reader.
 * Destroying the Angular scope unsubscribes; the caller still owns its handle.
 */
export function stateqlSignal<T>(
  reader: StoreReader<T>,
  options: StateQLSignalOptions = {},
): Signal<T> {
  assertNotInReactiveContext(stateqlSignal);
  const destroyRef = options.destroyRef ?? inject(DestroyRef);
  if (destroyRef.destroyed)
    throw new Error('Cannot observe StateQL in a destroyed Angular scope.');
  const snapshot = signal(reader.getSnapshot());
  let active = true;
  let establishing = true;
  const update = () => {
    // Re-read after subscribe returns its cleanup. A synchronous notification
    // must not throw before we have a way to release the registration.
    if (!active || establishing) return;
    const next = reader.getSnapshot();
    if (active) snapshot.set(next);
  };
  let unsubscribe: () => void;
  try {
    unsubscribe = reader.subscribe(update);
  } catch (error) {
    active = false;
    throw error;
  }
  establishing = false;
  const cleanup = () => {
    if (!active) return;
    active = false;
    unsubscribe();
  };
  let unregister: (() => void) | undefined;
  try {
    // A source can change while subscribing. Close the read/subscribe gap.
    if (destroyRef.destroyed)
      throw new Error('Angular scope was destroyed while subscribing.');
    unregister = destroyRef.onDestroy(cleanup);
    update();
  } catch (error) {
    cleanup();
    unregister?.();
    throw error;
  }
  return snapshot.asReadonly();
}

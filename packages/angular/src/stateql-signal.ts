import {
  assertNotInReactiveContext,
  DestroyRef,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import type { StoreReader } from '@jchewitt/stateql-core';
import { observeReader } from './observe-reader.js';

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
  const cleanup = observeReader(reader, (value) => {
    if (!destroyRef.destroyed) snapshot.set(value);
  });
  let unregister: (() => void) | undefined;
  try {
    if (destroyRef.destroyed)
      throw new Error('Angular scope was destroyed while subscribing.');
    unregister = destroyRef.onDestroy(cleanup);
  } catch (error) {
    cleanup();
    unregister?.();
    throw error;
  }
  return snapshot.asReadonly();
}

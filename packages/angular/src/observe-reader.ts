import type { StoreReader, Unsubscribe } from '@jchewitt/stateql-core';

/** Subscribe and close the read/subscribe gap without losing setup cleanup. */
export function observeReader<T>(
  reader: StoreReader<T>,
  accept: (value: T) => void,
): Unsubscribe {
  let active = true;
  let establishing = true;
  const update = () => {
    if (!active || establishing) return;
    const next = reader.getSnapshot();
    if (active) accept(next);
  };
  let unsubscribe: Unsubscribe;
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
  try {
    update();
  } catch (error) {
    cleanup();
    throw error;
  }
  return cleanup;
}

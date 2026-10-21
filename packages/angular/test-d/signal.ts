import type { DestroyRef, Signal } from '@angular/core';
import type { StoreReader } from '@launch-echo/stateql-core';
import { stateqlSignal } from '../src/public-api.js';

declare const reader: StoreReader<Readonly<{ count: number }>>;
declare const destroyRef: DestroyRef;
const state: Signal<Readonly<{ count: number }>> = stateqlSignal(reader, {
  destroyRef,
});
const count: number = state().count;
void count;
// @ts-expect-error the adapter exposes no writable signal API
state.set({ count: 2 });
// @ts-expect-error source types are preserved
state().missing;
// @ts-expect-error immutable source snapshots stay immutable
state().count = 2;

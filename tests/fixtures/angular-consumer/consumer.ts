import { Component } from '@angular/core';
import type { StoreReader } from '@jchewitt/stateql-core';
import { stateqlSignal } from '@jchewitt/stateql-angular';

const reader: StoreReader<Readonly<{ value: string }>> = {
  getSnapshot: () => Object.freeze({ value: 'packaged snapshot' }),
  subscribe: () => () => {},
};

@Component({
  selector: 'packed-consumer',
  standalone: true,
  template: '<span>{{ snapshot().value }}</span>',
})
export class Consumer {
  readonly snapshot = stateqlSignal(reader);
}

declare const consumer: Consumer;
// @ts-expect-error a snapshot signal cannot be written to
consumer.snapshot.set({ value: 'draft' });
// @ts-expect-error snapshot shape must be preserved through the packed declarations
consumer.snapshot().missing;
// @ts-expect-error immutable source remains immutable
consumer.snapshot().value = 'draft';

import type { Disposable, StoreReader, Unsubscribe } from '../src/index.js';

declare const reader: StoreReader<Readonly<{ accountId: string }>>;
const unsubscribe: Unsubscribe = reader.subscribe(() => {});
unsubscribe();

const accountId: string = reader.getSnapshot().accountId;
void accountId;

// @ts-expect-error Snapshot immutability is part of the consumer's declared type.
reader.getSnapshot().accountId = 'changed';

// @ts-expect-error A field outside the declared projection cannot be read.
reader.getSnapshot().amount;

// @ts-expect-error subscribe accepts a notification callback, not a data argument.
reader.subscribe((value: string) => value);

declare const disposable: Disposable;
disposable.dispose();

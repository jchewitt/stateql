import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import {
  AcquisitionClient,
  AcquisitionSupersededError,
} from '@jchewitt/stateql-core';
import {
  createWholeResourceFixture,
  createEventFixture,
} from './fake-adapters.mjs';

export async function runAdapterExample(log = console.log) {
  const client = new AcquisitionClient();
  const a = createWholeResourceFixture('A'),
    b = createWholeResourceFixture('B');
  const events = createEventFixture();
  const disconnect = events.connect(client, a.source);
  try {
    const first = client.watch(a.source);
    const second = client.watch(a.source);
    const otherScope = client.watch(b.source);
    await Promise.all([first.ready, second.ready, otherScope.ready]);
    a.advance();
    await first.invalidate('accountId');
    assert.equal(first.getSnapshot().records?.[0]?.data['amount'], 10);
    assert.equal(
      second.getSnapshot().records?.[0]?.data['accountId'],
      'A-account-v2',
    );
    a.holdNext();
    const late = assert.rejects(first.refresh(), AcquisitionSupersededError);
    for (let i = 0; i < 100 && !a.waiting(); i++) await Promise.resolve();
    assert.equal(a.waiting(), true);
    events.emit({
      address: a.source.stateAddress,
      id: 'invoice-1',
      accountId: 'A-pushed',
    });
    a.release();
    await late;
    assert.equal(
      second.getSnapshot().records?.[0]?.data['accountId'],
      'A-pushed',
    );
    assert.equal(first.getSnapshot().records?.[0]?.data['amount'], 20);
    assert.equal(
      otherScope.getSnapshot().records?.[0]?.data['accountId'],
      'B-account-v1',
    );
    log(
      'Whole-resource adapter: narrow invalidation preserved the cached amount.',
    );
    log(
      'Event adapter: both A consumers updated; B stayed isolated; late read could not roll back the event.',
    );
    return {
      readsA: a.reads(),
      readsB: b.reads(),
      accountId: second.getSnapshot().records?.[0]?.data['accountId'],
    };
  } finally {
    disconnect();
    client.dispose();
    assert.equal(events.listeners(), 0);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runAdapterExample();

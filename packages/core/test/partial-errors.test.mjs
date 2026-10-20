import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AcquisitionClient, StateStore } from '../dist/index.js';

const path = (name) => [{ name, arguments: {} }];
const field = (name) => ({
  name,
  responseName: name,
  arguments: {},
  children: [],
});
const write = (name, value) => ({ kind: 'write', path: path(name), value });
const failure = (name, message = 'failed') => ({
  kind: 'error',
  path: path(name),
  message,
});
const record = (fields, id = '1') => ({ identity: { id }, fields });

test('broader-source failures outside requested coverage do not alter sibling values or errors', async (t) => {
  const client = new AcquisitionClient();
  t.after(() => client.dispose());
  const selection = [field('name'), field('amount')];
  let response = [record([write('name', 'old'), write('amount', 10)])];
  const handle = client.watch({
    stateAddress: 'one',
    selection,
    fetchSelection: () => selection,
    read: async () => response,
  });
  await handle.ready;
  response = [record([write('name', 'new'), failure('amount')])];
  await handle.refresh('name');
  assert.equal(handle.getSnapshot().records[0].data.amount, 10);
  assert.equal(handle.getSnapshot().records[0].data.name, 'new');
  assert.equal(handle.getSnapshot().stale, false);
  response = [record([failure('name'), write('amount', 99)])];
  await assert.rejects(handle.refresh('name'), /failed/);
  assert.equal(handle.getSnapshot().records[0].data.name, 'new');
  assert.equal(handle.getSnapshot().records[0].data.amount, 10);
  assert.equal(handle.getSnapshot().complete, false);
});

test('null responses cannot clear an invalidation made during the read, even before membership exists', async (t) => {
  const client = new AcquisitionClient();
  t.after(() => client.dispose());
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const handle = client.watch({
    stateAddress: 'one',
    selection: [field('name')],
    read: async () => {
      calls++;
      await gate;
      return calls === 1 ? { kind: 'null' } : [record([write('name', 'new')])];
    },
  });
  await Promise.resolve();
  await handle.invalidate('name', { refetch: 'none' });
  release();
  await handle.ready;
  assert.equal(handle.getSnapshot().records, null);
  assert.equal(handle.getSnapshot().stale, true);
  await handle.ensure();
  assert.equal(handle.getSnapshot().records[0].data.name, 'new');
  assert.equal(handle.getSnapshot().stale, false);
});

test('invalid field failures, ignored records and malformed null envelopes reject atomically', async (t) => {
  const client = new AcquisitionClient();
  t.after(() => client.dispose());
  let response = [record([write('name', 'old')])];
  const handle = client.watch({
    stateAddress: 'one',
    collection: true,
    selection: [field('name')],
    read: async () => response,
  });
  await handle.ready;
  const before = handle.getSnapshot().records;
  for (const malformed of [
    [record([write('name', 'new')]), record([failure('name', '')], 'ignored')],
    [record([{ ...failure('name'), structuralNull: true }])],
    [record([{ ...failure('name'), structuralNull: 'yes' }])],
    [record([failure('private')])],
    [record([failure('name'), write('name', 'contradiction')])],
    { kind: 'null', error: '' },
    { kind: 'null', error: 3 },
    {},
    null,
  ]) {
    response = malformed;
    await assert.rejects(handle.refresh());
    assert.deepEqual(handle.getSnapshot().records, before);
  }
});

test('resource null commits remove old records atomically and failed batches cannot clear them', () => {
  const store = new StateStore();
  const view = store.watch('one', [field('name')]);
  store.commit('one', [
    { kind: 'membership', records: [{ id: '1' }] },
    { ...write('name', 'old'), record: { id: '1' } },
  ]);
  const before = view.getSnapshot();
  assert.throws(() =>
    store.commit('one', [
      { kind: 'resource-null' },
      { ...write('name', 'bad'), record: { id: '1' } },
    ]),
  );
  assert.equal(view.getSnapshot(), before);
  store.commit('one', [{ kind: 'resource-null', error: 'failed' }]);
  assert.equal(view.getSnapshot().records, null);
  assert.equal(view.getSnapshot().resourceError, 'failed');
  assert.equal(view.getSnapshot().complete, false);
  store.commit('one', [{ kind: 'membership', records: [{ id: '1' }] }]);
  assert.equal(view.getSnapshot().records[0].data.name, undefined);
  assert.equal(view.getSnapshot().resourceError, undefined);
  store.dispose();
});

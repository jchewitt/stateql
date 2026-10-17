import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AcquisitionClient } from '../dist/index.js';
const field = (name) => ({
  name,
  responseName: name,
  arguments: {},
  children: [],
});
const record = (fields) => ({ identity: { id: '1' }, fields });
const write = (name, value) => ({
  kind: 'write',
  path: [{ name, arguments: {} }],
  value,
});

test('cross-consumer reads inside a listener see the same committed state without swallowing notifications', async () => {
  const errors = [];
  const client = new AcquisitionClient({
    onListenerError: (error) => errors.push(error),
  });
  const source = {
    stateAddress: 'one',
    selection: [field('name')],
    read: async () => [record([write('name', 'A')])],
  };
  const first = client.watch(source),
    second = client.watch(source);
  let firstComplete = 0,
    secondComplete = 0;
  first.subscribe(() => {
    if (first.getSnapshot().complete) {
      firstComplete++;
      assert.equal(second.getSnapshot().records[0].data.name, 'A');
    }
  });
  second.subscribe(() => {
    if (second.getSnapshot().complete) secondComplete++;
  });
  await Promise.all([first.ready, second.ready]);
  assert.ok(firstComplete > 0);
  assert.equal(firstComplete, secondComplete);
  assert.deepEqual(errors, []);
  client.dispose();
});

test('portable acquisition rejects writes outside requested coverage before committing', async () => {
  const client = new AcquisitionClient();
  const handle = client.watch({
    stateAddress: 'one',
    selection: [field('name')],
    read: async () => [
      record([write('name', 'valid'), write('private', 'unexpected')]),
    ],
  });
  await assert.rejects(handle.ready, /coverage/);
  assert.equal(handle.getSnapshot().records, undefined);
  assert.equal(handle.getSnapshot().complete, false);
  client.dispose();
});
test('omissions remain incomplete and can be filled by a later acquisition', async () => {
  const client = new AcquisitionClient();
  let complete = false;
  const requests = [];
  const handle = client.watch({
    stateAddress: 'one',
    selection: [field('name'), field('amount')],
    read: async (fields) => {
      requests.push(fields.map((f) => f.name));
      return [record(complete ? [write('amount', 10)] : [write('name', 'A')])];
    },
  });
  await assert.rejects(handle.ready, /omitted/);
  assert.equal(handle.getSnapshot().records[0].data.name, 'A');
  assert.equal(handle.getSnapshot().complete, false);
  complete = true;
  await handle.ensure();
  assert.deepEqual(requests, [['amount', 'name'], ['amount']]);
  assert.equal(handle.getSnapshot().complete, true);
  client.dispose();
});
test('a last-owner disposal ignores late data and a future view acquires a fresh baseline', async () => {
  const client = new AcquisitionClient();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const source = {
    stateAddress: 'one',
    selection: [field('name')],
    read: async () => {
      calls++;
      await gate;
      return [record([write('name', String(calls))])];
    },
  };
  const first = client.watch(source);
  await Promise.resolve();
  first.dispose();
  release();
  await assert.rejects(first.ready, /owners/);
  const next = client.watch(source);
  await next.ready;
  assert.equal(calls, 2);
  assert.equal(next.getSnapshot().records[0].data.name, '2');
  client.dispose();
});

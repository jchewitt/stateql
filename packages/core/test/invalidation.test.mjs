import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AcquisitionClient } from '../dist/index.js';

const field = (name) => ({
  name,
  responseName: name,
  arguments: {},
  children: [],
});
const write = (name, value) => ({
  kind: 'write',
  path: [{ name, arguments: {} }],
  value,
});
const record = (fields) => ({ identity: { id: '1' }, fields });
function gate() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(t, options = {}) {
  const client = new AcquisitionClient();
  t.after(() => client.dispose());
  let version = 1;
  const requests = [];
  const source = {
    authority: {}, // Selection wrappers below represent the same backend.
    stateAddress: 'invoices',
    selection: [field('accountId'), field('amount')],
    read: async (fields) => {
      requests.push(fields.map((f) => f.name));
      return [record(fields.map((f) => write(f.name, version)))];
    },
    ...options,
  };
  return {
    client,
    source,
    requests,
    advance: () => {
      version++;
    },
  };
}

test('mark-only invalidation is synchronous, shared, and preserves unrelated freshness and data', async (t) => {
  const { client, source, requests, advance } = fixture(t);
  const full = client.watch(source);
  const amount = client.watch({ ...source, selection: [field('amount')] });
  await Promise.all([full.ready, amount.ready]);
  const before = amount.getSnapshot();
  advance();
  const invalidation = full.invalidate('accountId', { refetch: 'none' });
  assert.equal(full.getSnapshot().stale, true);
  assert.deepEqual(
    { ...full.getSnapshot().records[0].data },
    { accountId: 1, amount: 1 },
  );
  assert.equal(amount.getSnapshot(), before);
  await invalidation;
  assert.equal(requests.length, 1);
  await full.ensure();
  assert.deepEqual(requests, [['accountId', 'amount'], ['accountId']]);
  assert.deepEqual(
    { ...full.getSnapshot().records[0].data },
    { accountId: 2, amount: 1 },
  );
  assert.equal(full.getSnapshot().stale, false);
  assert.equal(amount.getSnapshot(), before);
});

test('a whole-resource source fetches broadly but commits only requested fields', async (t) => {
  const fetched = [];
  let version = 1;
  const { client, source } = fixture(t, {
    fetchSelection: () => [field('accountId'), field('amount')],
    read: async (fields) => {
      fetched.push(fields.map((f) => f.name));
      return [record([write('accountId', version), write('amount', version)])];
    },
  });
  const full = client.watch(source);
  await full.ready;
  const amount = client.watch({
    ...source,
    selection: [field('amount')],
    fetchSelection: undefined,
  });
  await amount.ready;
  const before = amount.getSnapshot();
  version = 2;
  await full.invalidate('accountId');
  assert.deepEqual(fetched, [
    ['accountId', 'amount'],
    ['accountId', 'amount'],
  ]);
  assert.deepEqual(
    { ...full.getSnapshot().records[0].data },
    { accountId: 2, amount: 1 },
  );
  assert.equal(amount.getSnapshot(), before);
});

test('invalid fetched coverage rejects without reading or committing', async (t) => {
  const { client, source, requests } = fixture(t, {
    fetchSelection: () => [field('amount')],
  });
  const handle = client.watch(source);
  await assert.rejects(handle.ready);
  assert.equal(requests.length, 0);
  assert.equal(handle.getSnapshot().records, undefined);
  assert.equal(handle.getSnapshot().fetching, false);
});

test('refresh forces a read without first marking fresh values stale and reports omissions even with cached values', async (t) => {
  let omit = false;
  let blocked;
  const began = gate();
  const { client, source } = fixture(t, {
    read: async (fields) => {
      if (blocked) {
        began.resolve();
        await blocked.promise;
      }
      return [record(omit ? [] : fields.map((f) => write(f.name, 1)))];
    },
  });
  const handle = client.watch(source);
  await handle.ready;
  blocked = gate();
  const refreshing = handle.refresh('accountId');
  await began.promise;
  assert.equal(handle.getSnapshot().fetching, true);
  assert.equal(handle.getSnapshot().stale, false);
  omit = true;
  blocked.resolve();
  await assert.rejects(refreshing, /omitted/);
  assert.equal(handle.getSnapshot().records[0].data.accountId, 1);
  assert.match(handle.getSnapshot().error, /omitted/);
  assert.equal(handle.getSnapshot().fetching, false);
});

test('invalidation during initial acquisition survives its response even before membership exists', async (t) => {
  const blocked = gate(),
    began = gate();
  let calls = 0;
  const { client, source } = fixture(t, {
    read: async (fields) => {
      calls++;
      if (calls === 1) {
        began.resolve();
        await blocked.promise;
      }
      return [record(fields.map((f) => write(f.name, calls)))];
    },
  });
  const handle = client.watch(source);
  await began.promise;
  await handle.invalidate('accountId', { refetch: 'none' });
  blocked.resolve();
  await handle.ready;
  assert.equal(calls, 1);
  assert.deepEqual(
    handle.getSnapshot().records[0].fields.map((f) => [f.path[0], f.stale]),
    [
      ['accountId', true],
      ['amount', false],
    ],
  );
  await handle.ensure();
  assert.equal(calls, 2);
  assert.deepEqual(
    { ...handle.getSnapshot().records[0].data },
    { accountId: 2, amount: 1 },
  );
  assert.equal(handle.getSnapshot().stale, false);
});

test('default invalidation starts a newer read; an earlier full refresh cannot overwrite it', async (t) => {
  const blocked = gate(),
    began = gate();
  let calls = 0;
  const { client, source } = fixture(t, {
    read: async (fields) => {
      const version = ++calls;
      if (version === 2) {
        began.resolve();
        await blocked.promise;
      }
      return [record(fields.map((f) => write(f.name, version)))];
    },
  });
  const full = client.watch(source);
  const duplicate = client.watch(source);
  await Promise.all([full.ready, duplicate.ready]);
  const oldRefresh = assert.rejects(full.refresh(), /superseded/);
  await began.promise;
  const pending = duplicate.invalidate('accountId');
  assert.equal(full.getSnapshot().stale, true);
  const observations = [];
  full.subscribe(() => {
    const value = full.getSnapshot();
    observations.push([
      value.records[0].data.accountId,
      value.records[0].fields[0].stale,
    ]);
  });
  blocked.resolve();
  await Promise.all([oldRefresh, pending]);
  assert.ok(!observations.some(([value]) => value === 2));
  assert.deepEqual(
    { ...full.getSnapshot().records[0].data },
    { accountId: 3, amount: 2 },
  );
  assert.equal(duplicate.getSnapshot().stale, false);
});

test('no-argument invalidation targets only the calling view; invalid targets and disposed handles do no work', async (t) => {
  const { client, source, requests, advance } = fixture(t);
  const full = client.watch(source);
  await full.ready;
  const narrow = client.watch({ ...source, selection: [field('accountId')] });
  await narrow.ready;
  advance();
  await narrow.invalidate();
  assert.deepEqual(
    { ...full.getSnapshot().records[0].data },
    { accountId: 2, amount: 1 },
  );
  const before = full.getSnapshot();
  await assert.rejects(narrow.invalidate('amount'));
  await assert.rejects(narrow.refresh('unknown'));
  await assert.rejects(narrow.invalidate('accountId', { refetch: 'invalid' }));
  assert.equal(full.getSnapshot(), before);
  narrow.dispose();
  await assert.rejects(narrow.invalidate(), /disposed/);
  await assert.rejects(narrow.refresh(), /disposed/);
  assert.equal(requests.length, 2);
});

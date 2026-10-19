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
const record = (id, fields) => ({ identity: { id }, fields });
const ids = (handle) => handle.getSnapshot().records?.map((r) => r.identity.id);
const values = (handle, name) =>
  handle.getSnapshot().records?.map((r) => r.data[name]);
function gate() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(t) {
  const client = new AcquisitionClient();
  t.after(() => client.dispose());
  let rows = [
    { id: '1', name: 'one', amount: 10 },
    { id: '2', name: 'two', amount: 20 },
  ];
  let intercept = async (result) => result;
  const requests = [];
  const source = {
    collection: true,
    stateAddress: 'items',
    selection: [field('name'), field('amount')],
    read: async (fields) => {
      requests.push(fields.map((f) => f.name));
      return intercept(
        rows.map((row) =>
          record(
            row.id,
            fields.map((f) => write(f.name, row[f.name])),
          ),
        ),
      );
    },
  };
  return {
    client,
    source,
    requests,
    setRows: (next) => {
      rows = next;
    },
    intercept: (fn) => {
      intercept = fn;
    },
  };
}

test('narrow reads patch known identities, ignore newcomers, retain missing members and flag incomplete refresh', async (t) => {
  const f = fixture(t);
  const full = f.client.watch(f.source);
  const amount = f.client.watch({ ...f.source, selection: [field('amount')] });
  await Promise.all([full.ready, amount.ready]);
  f.setRows([
    { id: '3', name: 'new', amount: 30 },
    { id: '2', name: 'updated', amount: 200 },
  ]);
  await assert.rejects(full.refresh('name'), /incomplete.*refreshList/);
  assert.deepEqual(ids(full), ['1', '2']);
  assert.deepEqual(values(full, 'name'), ['one', 'updated']);
  assert.deepEqual(values(full, 'amount'), [10, 20]);
  assert.equal(
    full.getSnapshot().records[0].fields.find((f) => f.path[0] === 'name')
      .stale,
    true,
  );
  assert.equal(
    full.getSnapshot().records[1].fields.find((f) => f.path[0] === 'name')
      .stale,
    false,
  );
  assert.equal(amount.getSnapshot().membershipStale, true);
  assert.equal(
    amount.getSnapshot().records.every((r) => r.fields.every((f) => !f.stale)),
    true,
  );
  assert.equal(full.getSnapshot().complete, true);
  assert.equal(full.getSnapshot().stale, true);
});

test('unknown-only membership changes resolve field refresh but stay flagged until explicit list refresh', async (t) => {
  const f = fixture(t);
  const handle = f.client.watch(f.source);
  await handle.ready;
  f.setRows([
    { id: '2', name: 'two-v2', amount: 200 },
    { id: '1', name: 'one-v2', amount: 100 },
    { id: '3', name: 'three', amount: 30 },
  ]);
  await handle.invalidate('name');
  assert.deepEqual(ids(handle), ['1', '2']);
  assert.deepEqual(values(handle, 'name'), ['one-v2', 'two-v2']);
  assert.equal(handle.getSnapshot().membershipStale, true);
  const count = f.requests.length;
  await handle.ensure();
  assert.equal(f.requests.length, count); // ensure does not silently replace membership
  await handle.refreshList();
  assert.deepEqual(ids(handle), ['2', '1', '3']);
  assert.deepEqual(values(handle, 'amount'), [200, 100, 30]);
  assert.equal(handle.getSnapshot().membershipStale, false);
  assert.equal(handle.getSnapshot().stale, false);
});

test('list replacement is atomic across consumers and only acquires the calling view; peers can ensure missing fields', async (t) => {
  const f = fixture(t);
  const full = f.client.watch(f.source);
  await full.ready;
  const narrow = f.client.watch({ ...f.source, selection: [field('name')] });
  const amount = f.client.watch({ ...f.source, selection: [field('amount')] });
  await Promise.all([narrow.ready, amount.ready]);
  const began = gate(),
    blocked = gate();
  f.intercept(async (result) => {
    began.resolve();
    await blocked.promise;
    return result;
  });
  f.setRows([
    { id: '2', name: 'new-two', amount: 200 },
    { id: '3', name: 'three', amount: 30 },
  ]);
  const observations = [];
  narrow.subscribe(() => observations.push([ids(narrow), ids(full)]));
  const refresh = narrow.refreshList();
  await began.promise;
  assert.equal(amount.getSnapshot().fetching, true); // membership affects disjoint views
  blocked.resolve();
  await refresh;
  assert.ok(
    observations.every(([a, b]) => JSON.stringify(a) === JSON.stringify(b)),
  );
  assert.deepEqual(ids(full), ['2', '3']);
  assert.deepEqual(values(full, 'amount'), [20, undefined]);
  assert.equal(full.getSnapshot().complete, false);
  assert.equal(narrow.getSnapshot().complete, true);
  assert.equal(amount.getSnapshot().fetching, false);
  await full.ensure();
  assert.deepEqual(f.requests.at(-1), ['amount']);
  assert.deepEqual(values(full, 'amount'), [200, 30]);
  assert.equal(full.getSnapshot().complete, true);
});

test('empty lists can flag newcomers without insertion, then refresh to populated or empty membership', async (t) => {
  const f = fixture(t);
  f.setRows([]);
  const handle = f.client.watch(f.source);
  await handle.ready;
  assert.equal(handle.getSnapshot().membershipStale, false);
  f.setRows([{ id: '1', name: 'one', amount: 10 }]);
  await handle.refresh();
  assert.deepEqual(ids(handle), []);
  assert.equal(handle.getSnapshot().membershipStale, true);
  await handle.refreshList();
  assert.deepEqual(ids(handle), ['1']);
  f.setRows([]);
  await assert.rejects(handle.invalidate('name'), /incomplete/);
  assert.deepEqual(ids(handle), ['1']);
  await handle.refreshList();
  assert.deepEqual(ids(handle), []);
  assert.equal(handle.getSnapshot().complete, true);
  assert.equal(handle.getSnapshot().stale, false);
  assert.equal(handle.getSnapshot().error, undefined);
});

test('invalid or incomplete whole-list responses leave previous membership and fields untouched', async (t) => {
  const f = fixture(t);
  const handle = f.client.watch(f.source);
  const peer = f.client.watch(f.source);
  await Promise.all([handle.ready, peer.ready]);
  const original = peer.getSnapshot();
  const bad = [
    [record('3', [write('name', 'partial')])],
    [record('3', [write('name', 'x'), write('amount', 3)]), record('3', [])],
    [{ identity: {}, fields: [write('name', 'x'), write('amount', 3)] }],
    [
      record('3', [
        write('name', 'x'),
        write('amount', 3),
        write('private', 1),
      ]),
    ],
    [record('3', [write('name', 'x'), write('name', 'y'), write('amount', 3)])],
  ];
  for (const response of bad) {
    f.intercept(async () => response);
    await assert.rejects(handle.refreshList());
    assert.deepEqual(peer.getSnapshot(), original);
  }
  f.intercept(async () => {
    throw new Error('offline');
  });
  await assert.rejects(handle.refreshList(), /offline/);
  assert.deepEqual(peer.getSnapshot(), original);
});

test('malformed ignored newcomers also prevent a partial narrow commit', async (t) => {
  const f = fixture(t);
  const handle = f.client.watch(f.source);
  await handle.ready;
  f.intercept(async () => [
    record('1', [write('name', 'changed')]),
    { identity: {}, fields: [write('name', 'new')] },
  ]);
  await assert.rejects(handle.refresh('name'), /identity/);
  assert.deepEqual(values(handle, 'name'), ['one', 'two']);
  assert.equal(handle.getSnapshot().membershipStale, false);
});

test('missing values on ignored newcomers or fetched-only fields reject before any response commits', async (t) => {
  const f = fixture(t);
  const handle = f.client.watch({
    ...f.source,
    fetchSelection: () => f.source.selection,
  });
  await handle.ready;
  const missing = { kind: 'write', path: [{ name: 'name', arguments: {} }] };
  const malformed = [
    [
      record('1', [write('name', 'changed')]),
      record('2', [write('name', 'changed-two')]),
      record('3', [missing]),
    ],
    [
      record('1', [write('name', 'changed'), write('amount', undefined)]),
      record('2', [write('name', 'changed-two')]),
    ],
  ];
  for (const response of malformed) {
    f.intercept(async () => response);
    await assert.rejects(handle.refresh('name'));
    assert.deepEqual(values(handle, 'name'), ['one', 'two']);
    assert.deepEqual(values(handle, 'amount'), [10, 20]);
    assert.equal(handle.getSnapshot().membershipStale, false);
  }
});

test('invalidations during a list refresh remain stale on retained and new members', async (t) => {
  const f = fixture(t);
  const handle = f.client.watch(f.source);
  await handle.ready;
  const began = gate(),
    blocked = gate();
  f.intercept(async (result) => {
    began.resolve();
    await blocked.promise;
    return result;
  });
  f.setRows([
    { id: '2', name: 'new-two', amount: 200 },
    { id: '3', name: 'three', amount: 30 },
  ]);
  const refreshing = handle.refreshList();
  await began.promise;
  await handle.invalidate('name', { refetch: 'none' });
  blocked.resolve();
  await refreshing;
  assert.deepEqual(ids(handle), ['2', '3']);
  assert.equal(handle.getSnapshot().membershipStale, false);
  assert.equal(
    handle
      .getSnapshot()
      .records.every((r) => r.fields.find((f) => f.path[0] === 'name').stale),
    true,
  );
  await handle.ensure();
  assert.equal(handle.getSnapshot().stale, false);
});

test('collection capability and disposal guard explicit list refresh, including late responses', async (t) => {
  const f = fixture(t);
  const singleton = f.client.watch({
    ...f.source,
    stateAddress: 'single',
    collection: false,
  });
  await singleton.ready;
  await assert.rejects(singleton.refreshList(), /collection/);
  const handle = f.client.watch(f.source);
  await handle.ready;
  const began = gate(),
    blocked = gate();
  f.intercept(async (result) => {
    began.resolve();
    await blocked.promise;
    return result;
  });
  const refreshing = handle.refreshList();
  await began.promise;
  handle.dispose();
  const last = handle.getSnapshot();
  blocked.resolve();
  await assert.rejects(refreshing, /owners/);
  assert.equal(handle.getSnapshot(), last);
  await assert.rejects(handle.refreshList(), /disposed/);
});

test('new list members establish nested identities before child writes and reject contradictory trees', async (t) => {
  const client = new AcquisitionClient();
  t.after(() => client.dispose());
  const user = { ...field('user'), children: [field('name')] };
  const path = [{ name: 'user', arguments: {} }];
  let response = [];
  const handle = client.watch({
    collection: true,
    stateAddress: 'nested',
    selection: [user],
    read: async () => response,
  });
  await handle.ready;
  const child = {
    kind: 'write',
    path: [...path, { name: 'name', arguments: {} }],
    value: 'Ada',
  };
  response = [
    record('1', [child, { kind: 'object', path, identity: { id: 'user-1' } }]),
  ];
  await handle.refreshList();
  assert.equal(handle.getSnapshot().records[0].data.user.name, 'Ada');
  assert.equal(handle.getSnapshot().complete, true);
  response = [record('2', [child, { kind: 'write', path, value: null }])];
  await assert.rejects(handle.refreshList(), /descendant/);
  assert.deepEqual(ids(handle), ['1']);
});

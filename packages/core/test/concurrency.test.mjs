import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AcquisitionClient,
  AcquisitionCancelledError,
  AcquisitionSupersededError,
} from '../dist/index.js';

const field = (name, children = []) => ({
  name,
  responseName: name,
  arguments: {},
  children,
});
const path = (...names) => names.map((name) => ({ name, arguments: {} }));
const write = (name, value) => ({ kind: 'write', path: path(name), value });
const record = (fields, id = '1') => ({ identity: { id }, fields });
const rows = (name, amount = 10) => [
  record([write('name', name), write('amount', amount)]),
];
const tracked = (promise) => {
  void promise.catch(() => {});
  return promise;
};
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail('Expected asynchronous progress.');
}
function setup(
  t,
  selection = [field('name'), field('amount')],
  collection = false,
) {
  const client = new AcquisitionClient();
  t.after(() => client.dispose());
  const reads = [];
  const source = {
    stateAddress: 'one',
    selection,
    collection,
    read: (fields, { signal }) =>
      new Promise((resolve, reject) =>
        reads.push({ fields, signal, resolve, reject }),
      ),
  };
  return { client, source, reads };
}
async function seed(f, response = rows('old')) {
  const handle = f.client.watch(f.source);
  await until(() => f.reads.length === 1);
  f.reads[0].resolve(response);
  await handle.ready;
  return handle;
}

test('identical forced reads share work; disposing one owner rejects only its promise', async (t) => {
  const f = setup(t);
  const first = await seed(f);
  const second = f.client.watch(f.source);
  await second.ready;
  const a = tracked(first.refresh('name')),
    b = tracked(second.refresh('name'));
  await until(() => f.reads.length === 2);
  await Promise.resolve();
  assert.equal(f.reads.length, 2);
  first.dispose();
  await assert.rejects(a, AcquisitionCancelledError);
  assert.equal(f.reads[1].signal.aborted, false);
  f.reads[1].resolve([record([write('name', 'new')])]);
  await b;
  assert.equal(second.getSnapshot().records[0].data.name, 'new');
});

test('initial disjoint consumers acquire one baseline before extending it', async (t) => {
  const f = setup(t);
  const name = f.client.watch({ ...f.source, selection: [field('name')] });
  const amount = f.client.watch({ ...f.source, selection: [field('amount')] });
  await until(() => f.reads.length === 1);
  f.reads[0].resolve([record([write('name', 'Ada')])]);
  await name.ready;
  await until(() => f.reads.length === 2);
  assert.deepEqual(
    f.reads[1].fields.map((f) => f.name),
    ['amount'],
  );
  f.reads[1].resolve([record([write('amount', 20)])]);
  await amount.ready;
  assert.equal(amount.getSnapshot().records[0].data.amount, 20);
  assert.equal(name.getSnapshot().records[0].data.name, 'Ada');
});

test('older full data cannot replace a newer field, but unaffected fields still commit', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  const old = tracked(handle.refresh());
  await until(() => f.reads.length === 2);
  const newer = handle.refresh('name');
  await until(() => f.reads.length === 3);
  f.reads[2].resolve([record([write('name', 'newest')])]);
  await newer;
  f.reads[1].resolve(rows('obsolete', 20));
  await assert.rejects(old, AcquisitionSupersededError);
  assert.deepEqual(
    { ...handle.getSnapshot().records[0].data },
    { name: 'newest', amount: 20 },
  );
  assert.equal(handle.getSnapshot().error, undefined);
  assert.equal(handle.getSnapshot().fetching, false);
});

test('disjoint requests can finish in either order without suppressing needed fields', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  const name = handle.refresh('name'),
    amount = handle.refresh('amount');
  await until(() => f.reads.length === 3);
  f.reads[2].resolve([record([write('amount', 20)])]);
  await amount;
  assert.equal(handle.getSnapshot().fetching, true);
  f.reads[1].resolve([record([write('name', 'new')])]);
  await name;
  assert.deepEqual(
    { ...handle.getSnapshot().records[0].data },
    { amount: 20, name: 'new' },
  );
});

test('older errors and omissions cannot damage fields completed by newer requests', async (t) => {
  for (const obsolete of [
    [
      record([
        { kind: 'error', path: path('name'), message: 'obsolete error' },
        write('amount', 20),
      ]),
    ],
    [record([write('amount', 20)])],
  ]) {
    const f = setup(t);
    const handle = await seed(f);
    const old = tracked(handle.refresh());
    await until(() => f.reads.length === 2);
    const newer = handle.refresh('name');
    await until(() => f.reads.length === 3);
    f.reads[2].resolve([record([write('name', 'new')])]);
    await newer;
    f.reads[1].resolve(obsolete);
    await assert.rejects(old, AcquisitionSupersededError);
    assert.equal(handle.getSnapshot().records[0].data.name, 'new');
    assert.equal(handle.getSnapshot().stale, false);
    assert.equal(handle.getSnapshot().error, undefined);
  }
});

test('a newer failed attempt still supersedes older writes and retains its own error', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  const old = tracked(handle.refresh());
  await until(() => f.reads.length === 2);
  const newer = tracked(handle.refresh('name'));
  await until(() => f.reads.length === 3);
  f.reads[2].reject(new Error('new request failed'));
  await assert.rejects(newer, /new request failed/);
  f.reads[1].resolve(rows('obsolete', 20));
  await assert.rejects(old, AcquisitionSupersededError);
  assert.equal(handle.getSnapshot().records[0].data.name, 'old');
  assert.equal(handle.getSnapshot().records[0].data.amount, 20);
  assert.equal(handle.getSnapshot().error, 'new request failed');
});

test('ensure after invalidation does not join work started before that invalidation', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  const old = tracked(handle.refresh('name'));
  await until(() => f.reads.length === 2);
  await handle.invalidate('name', { refetch: 'none' });
  const ensured = handle.ensure();
  await until(() => f.reads.length === 3);
  f.reads[2].resolve([record([write('name', 'fresh')])]);
  await ensured;
  f.reads[1].resolve([record([write('name', 'obsolete')])]);
  await assert.rejects(old, AcquisitionSupersededError);
  assert.equal(handle.getSnapshot().records[0].data.name, 'fresh');
  assert.equal(handle.getSnapshot().stale, false);
});

test('ensure rechecks coverage when the read it joined is superseded', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  await handle.invalidate('name', { refetch: 'none' });
  const old = tracked(handle.refresh('name'));
  await until(() => f.reads.length === 2);
  const ensured = handle.ensure();
  await Promise.resolve();
  await handle.invalidate('name', { refetch: 'none' });
  const fresh = handle.refresh('name');
  await until(() => f.reads.length === 3);
  f.reads[2].resolve([record([write('name', 'fresh')])]);
  await fresh;
  f.reads[1].resolve([record([write('name', 'obsolete')])]);
  await assert.rejects(old, AcquisitionSupersededError);
  await ensured;
  assert.equal(f.reads.length, 3);
  assert.equal(handle.getSnapshot().records[0].data.name, 'fresh');
});

test('automatic acquisition rechecks its own superseded read without redundant fetching', async (t) => {
  const f = setup(t);
  const handle = f.client.watch(f.source);
  await until(() => f.reads.length === 1);
  const fresh = tracked(handle.invalidate());
  await until(() => f.reads.length === 2);
  f.reads[1].resolve(rows('newest'));
  await fresh;
  f.reads[0].resolve(rows('obsolete'));
  await handle.ready;
  assert.equal(f.reads.length, 2);
  assert.equal(handle.getSnapshot().records[0].data.name, 'newest');
  assert.equal(handle.getSnapshot().error, undefined);
});

test('ensure rejects a real covering failure without waiting for another held read', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  await handle.invalidate(undefined, { refetch: 'none' });
  const name = tracked(handle.refresh('name'));
  const amount = tracked(handle.refresh('amount'));
  await until(() => f.reads.length === 3);
  const ensured = tracked(handle.ensure());
  await Promise.resolve();
  f.reads[1].reject(new Error('name failed'));
  await assert.rejects(ensured, /name failed/);
  await assert.rejects(name, /name failed/);
  f.reads[2].resolve([record([write('amount', 20)])]);
  await amount;
});

test('last relevant owner cancels even with a disjoint view; ignored late completion cannot affect a replacement owner', async (t) => {
  const f = setup(t);
  const initial = await seed(f);
  const name = f.client.watch({ ...f.source, selection: [field('name')] });
  const amount = f.client.watch({ ...f.source, selection: [field('amount')] });
  await Promise.all([name.ready, amount.ready]);
  initial.dispose();
  const pending = tracked(name.refresh());
  await until(() => f.reads.length === 2);
  name.dispose();
  const frozen = name.getSnapshot();
  await assert.rejects(pending, AcquisitionCancelledError);
  assert.equal(f.reads[1].signal.aborted, true);
  assert.equal(amount.getSnapshot().fetching, false);
  const replacement = f.client.watch({
    ...f.source,
    selection: [field('name')],
  });
  await replacement.ready;
  const fresh = replacement.refresh();
  await until(() => f.reads.length === 3);
  f.reads[2].resolve([record([write('name', 'replacement')])]);
  await fresh;
  f.reads[1].resolve([record([write('name', 'late')])]);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(replacement.getSnapshot().records[0].data.name, 'replacement');
  assert.equal(name.getSnapshot(), frozen);
});

test('client disposal settles pending work promptly and cancels adapters that never finish', async (t) => {
  const f = setup(t);
  const handle = f.client.watch(f.source);
  await until(() => f.reads.length === 1);
  f.client.dispose();
  const frozen = handle.getSnapshot();
  await assert.rejects(handle.ready, AcquisitionCancelledError);
  assert.equal(f.reads[0].signal.aborted, true);
  f.reads[0].reject(new Error('late rejection is consumed'));
  await Promise.resolve();
  assert.equal(handle.getSnapshot(), frozen);
});

test('late null resources cannot erase newer fields, and newer nulls block old resurrection', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  const oldNull = tracked(handle.refresh());
  await until(() => f.reads.length === 2);
  const fresh = handle.refresh('name');
  await until(() => f.reads.length === 3);
  f.reads[2].resolve([record([write('name', 'new')])]);
  await fresh;
  f.reads[1].resolve({ kind: 'null' });
  await assert.rejects(oldNull, AcquisitionSupersededError);
  assert.equal(handle.getSnapshot().records[0].data.name, 'new');
  const oldData = tracked(handle.refresh('amount'));
  await until(() => f.reads.length === 4);
  const nullNow = handle.refresh('name');
  await until(() => f.reads.length === 5);
  f.reads[4].resolve({ kind: 'null' });
  await nullNow;
  f.reads[3].resolve([record([write('amount', 99)])]);
  await assert.rejects(oldData, AcquisitionSupersededError);
  assert.equal(handle.getSnapshot().records, null);
});

test('nested structural nulls and identity changes block older sibling resurrection', async (t) => {
  for (const newer of [
    { kind: 'write', path: path('user'), value: null },
    { kind: 'object', path: path('user'), identity: { id: 'new-user' } },
  ]) {
    const f = setup(t, [field('user', [field('name'), field('nickname')])]);
    const handle = await seed(f, [
      record([
        { kind: 'object', path: path('user'), identity: { id: 'old-user' } },
        { kind: 'write', path: path('user', 'name'), value: 'old' },
        {
          kind: 'write',
          path: path('user', 'nickname'),
          value: 'old nickname',
        },
      ]),
    ]);
    const old = tracked(handle.refresh('user.nickname'));
    await until(() => f.reads.length === 2);
    const fresh = handle.refresh('user.name');
    await until(() => f.reads.length === 3);
    f.reads[2].resolve([
      record(
        newer.kind === 'object'
          ? [newer, { kind: 'write', path: path('user', 'name'), value: 'new' }]
          : [newer],
      ),
    ]);
    await fresh;
    f.reads[1].resolve([
      record([
        { kind: 'object', path: path('user'), identity: { id: 'old-user' } },
        { kind: 'write', path: path('user', 'nickname'), value: 'obsolete' },
      ]),
    ]);
    await assert.rejects(old, AcquisitionSupersededError);
    const user = handle.getSnapshot().records[0].data.user;
    if (newer.kind === 'write') assert.equal(user, null);
    else assert.deepEqual({ ...user }, { name: 'new' });
  }
});

test('older list replacement cannot remove a member touched by newer work', async (t) => {
  const f = setup(t, undefined, true);
  const handle = await seed(f);
  const old = tracked(handle.refreshList());
  await until(() => f.reads.length === 2);
  const fresh = handle.refresh('name');
  await until(() => f.reads.length === 3);
  f.reads[2].resolve([record([write('name', 'new')])]);
  await fresh;
  f.reads[1].resolve([
    record([write('name', 'other'), write('amount', 20)], '2'),
  ]);
  await assert.rejects(old, AcquisitionSupersededError);
  assert.equal(handle.getSnapshot().records[0].identity.id, '1');
  assert.equal(handle.getSnapshot().records[0].data.name, 'new');
});

test('a newer ordinary branch failure cannot be cleared by an older sibling response', async (t) => {
  const f = setup(t, [field('user', [field('name'), field('nickname')])]);
  const object = { kind: 'object', path: path('user'), identity: { id: 'u1' } };
  const handle = await seed(f, [
    record([
      object,
      { kind: 'write', path: path('user', 'name'), value: 'old name' },
      { kind: 'write', path: path('user', 'nickname'), value: 'old nickname' },
    ]),
  ]);
  const old = tracked(handle.refresh('user.nickname'));
  await until(() => f.reads.length === 2);
  const failed = tracked(handle.refresh('user.name'));
  await until(() => f.reads.length === 3);
  f.reads[2].resolve([
    record([
      { kind: 'error', path: path('user'), message: 'new branch error' },
    ]),
  ]);
  await assert.rejects(failed, /new branch error/);
  f.reads[1].resolve([
    record([
      object,
      { kind: 'write', path: path('user', 'nickname'), value: 'obsolete' },
    ]),
  ]);
  await assert.rejects(old, AcquisitionSupersededError);
  assert.equal(
    handle.getSnapshot().records[0].data.user.nickname,
    'old nickname',
  );
  assert.equal(
    handle.getSnapshot().records[0].fields.find((f) => f.path[1] === 'nickname')
      .error,
    'new branch error',
  );
  assert.equal(handle.getSnapshot().error, 'new branch error');
});

test('newer list replacement protects retained, removed and reinserted records from late fields', async (t) => {
  const f = setup(t, undefined, true);
  const handle = await seed(f);
  const old = tracked(handle.refresh('amount'));
  await until(() => f.reads.length === 2);
  const remove = handle.refreshList();
  await until(() => f.reads.length === 3);
  f.reads[2].resolve([]);
  await remove;
  const insert = handle.refreshList();
  await until(() => f.reads.length === 4);
  f.reads[3].resolve(rows('reinserted', 30));
  await insert;
  f.reads[1].resolve([record([write('amount', 999)])]);
  await assert.rejects(old, AcquisitionSupersededError);
  assert.equal(handle.getSnapshot().records[0].data.amount, 30);
});

test('source fingerprints prevent deduplicating different wire operations at the same state address', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  const other = f.client.watch({
    ...f.source,
    fingerprint: () => 'different-operation',
  });
  await other.ready;
  const a = tracked(handle.refresh('name')),
    b = other.refresh('name');
  await until(() => f.reads.length === 3);
  f.reads[2].resolve([record([write('name', 'new')])]);
  await b;
  f.reads[1].resolve([record([write('name', 'old')])]);
  await assert.rejects(a, AcquisitionSupersededError);
  assert.equal(handle.getSnapshot().records[0].data.name, 'new');
});

test('synchronous read failures and reentrant disposal leave no fetching work behind', async (t) => {
  const client = new AcquisitionClient();
  t.after(() => client.dispose());
  let broken = true;
  const handle = client.watch({
    stateAddress: 'one',
    selection: [field('name')],
    read: () => {
      if (broken) throw new Error('synchronous');
      return Promise.resolve([record([write('name', 'ok')])]);
    },
  });
  await assert.rejects(handle.ready, /synchronous/);
  assert.equal(handle.getSnapshot().fetching, false);
  broken = false;
  await handle.ensure();
  handle.subscribe(() => {
    if (handle.getSnapshot().fetching) handle.dispose();
  });
  await assert.rejects(handle.refresh(), AcquisitionCancelledError);
});

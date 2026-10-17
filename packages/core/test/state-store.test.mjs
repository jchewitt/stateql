import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StateStore, resourceAddress } from '../dist/index.js';

const field = (name, children = [], responseName = name, args = {}) => ({
  name,
  arguments: args,
  responseName,
  children,
});
const path = (...names) => names.map((name) => ({ name, arguments: {} }));
const a = { tenantId: 'A', id: '1' };
const b = { tenantId: 'A', id: '2' };
const address = resourceAddress(
  { source: 'test', scope: 'session' },
  path('billing', 'invoices'),
);
const write = (record, names, value) => ({
  kind: 'write',
  record,
  path: path(...names),
  value,
});
const membership = (...records) => ({ kind: 'membership', records });
const row = (view) => view.getSnapshot().records[0];

test('recovering a child beneath a missing/null parent preserves unrefreshed sibling errors', () => {
  for (const nullParent of [false, true]) {
    const store = new StateStore();
    const view = store.watch(address, [
      field('user', [field('name'), field('email'), field('phone')]),
    ]);
    store.commit(address, [
      membership(a),
      ...(nullParent ? [write(a, ['user'], null)] : []),
      {
        kind: 'error',
        record: a,
        path: path('user'),
        message: 'parent failed',
      },
      {
        kind: 'error',
        record: a,
        path: path('user', 'email'),
        message: 'email failed',
      },
    ]);
    store.commit(address, [write(a, ['user', 'name'], 'recovered')]);
    assert.equal(row(view).data.user.name, 'recovered');
    assert.equal(
      row(view).fields.find((f) => f.path[1] === 'name').error,
      undefined,
    );
    assert.equal(
      row(view).fields.find((f) => f.path[1] === 'email').error,
      'email failed',
    );
    assert.equal(
      row(view).fields.find((f) => f.path[1] === 'phone').error,
      'parent failed',
    );
    assert.equal(view.getSnapshot().complete, false);
  }
});

test('a successful child write recovers independently after branch staleness or failure', () => {
  for (const kind of ['stale', 'error']) {
    const store = new StateStore();
    const view = store.watch(address, [
      field('user', [field('name'), field('email')]),
    ]);
    store.commit(address, [
      membership(a),
      write(a, ['user', 'name'], 'A'),
      write(a, ['user', 'email'], 'old@test'),
    ]);
    store.commit(address, [
      {
        kind,
        record: a,
        path: path('user'),
        ...(kind === 'error' ? { message: 'branch failed' } : {}),
      },
    ]);
    store.commit(address, [write(a, ['user', 'name'], 'B')]);
    assert.equal(
      row(view).fields.find((f) => f.path[1] === 'name').stale,
      false,
    );
    assert.equal(
      row(view).fields.find((f) => f.path[1] === 'name').error,
      undefined,
    );
    assert.equal(
      row(view).fields.find((f) => f.path[1] === 'email').stale,
      true,
    );
    assert.equal(
      row(view).fields.find((f) => f.path[1] === 'email').error,
      kind === 'error' ? 'branch failed' : undefined,
    );
    store.commit(address, [{ kind: 'object', record: a, path: path('user') }]);
    assert.equal(
      row(view).fields.find((f) => f.path[1] === 'email').stale,
      true,
    );
    store.commit(address, [write(a, ['user', 'email'], 'new@test')]);
    assert.equal(view.getSnapshot().stale, false);
    assert.equal(view.getSnapshot().complete, true);
  }
});

test('nested errors and stale markers remain observable beneath missing or null parents', () => {
  const store = new StateStore();
  const view = store.watch(address, [
    field('user', [field('name', [], 'label')]),
  ]);
  store.commit(address, [
    membership(a),
    {
      kind: 'error',
      record: a,
      path: path('user', 'name'),
      message: 'missing-parent failure',
    },
  ]);
  assert.equal(view.getSnapshot().complete, false);
  assert.equal(row(view).data.user, undefined);
  assert.equal(
    row(view).fields.find((f) => f.error)?.error,
    'missing-parent failure',
  );
  assert.deepEqual(row(view).fields.find((f) => f.error)?.path, [
    'user',
    'label',
  ]);
  store.commit(address, [write(a, ['user'], null)]);
  assert.equal(view.getSnapshot().complete, true);
  store.commit(address, [
    {
      kind: 'error',
      record: a,
      path: path('user', 'name'),
      message: 'null-parent failure',
    },
  ]);
  assert.equal(row(view).data.user, null);
  assert.equal(view.getSnapshot().complete, false);
  assert.equal(view.getSnapshot().stale, true);
  assert.equal(
    row(view).fields.find((f) => f.error)?.error,
    'null-parent failure',
  );
  store.commit(address, [write(a, ['user'], null)]);
  store.commit(address, [
    { kind: 'stale', record: a, path: path('user', 'name') },
  ]);
  assert.equal(row(view).data.user, null);
  assert.equal(view.getSnapshot().stale, true);
  const unchanged = view.getSnapshot();
  store.commit(address, [
    {
      kind: 'error',
      record: a,
      path: path('user', 'unselected'),
      message: 'irrelevant',
    },
  ]);
  assert.equal(view.getSnapshot(), unchanged);
});

test('views share records while preserving selection boundaries, aliases and snapshot identity', () => {
  const store = new StateStore();
  const base = store.watch(address, [field('accountId')]);
  const extended = store.watch(address, [
    field('accountId', [], 'ledger'),
    field('amount'),
  ]);
  assert.equal(base.getSnapshot().complete, false);
  assert.equal(base.getSnapshot(), base.getSnapshot());
  let baseCalls = 0,
    extendedCalls = 0;
  base.subscribe(() => {
    baseCalls++;
  });
  extended.subscribe(() => {
    extendedCalls++;
  });
  store.commit(address, [
    membership(a),
    write(a, ['accountId'], 'old'),
    write(a, ['amount'], 10),
  ]);
  assert.equal(row(base).data.accountId, 'old');
  assert.equal(row(extended).data.ledger, 'old');
  assert.equal(row(base).data.amount, undefined);
  const original = base.getSnapshot();
  store.commit(address, [write(a, ['amount'], 20)]);
  assert.equal(base.getSnapshot(), original);
  assert.equal(baseCalls, 1);
  assert.equal(extendedCalls, 2);
  store.commit(address, [write(a, ['accountId'], 'new')]);
  assert.equal(row(base).data.accountId, 'new');
  assert.equal(row(extended).data.ledger, 'new');
  assert.equal(original.records[0].data.accountId, 'old');
  assert.equal(baseCalls, 2);
  const unchanged = base.getSnapshot();
  store.commit(address, [write(a, ['accountId'], 'new')]);
  assert.equal(base.getSnapshot(), unchanged);
});

test('known empty membership differs from missing data and explicit null differs from omission', () => {
  const store = new StateStore();
  const view = store.watch(address, [field('accountId'), field('amount')]);
  assert.equal(view.getSnapshot().records, undefined);
  store.commit(address, [membership()]);
  assert.deepEqual(view.getSnapshot().records, []);
  assert.equal(view.getSnapshot().complete, true);
  store.commit(address, [membership(a), write(a, ['accountId'], null)]);
  assert.equal(row(view).data.accountId, null);
  assert.equal(Object.hasOwn(row(view).data, 'amount'), false);
  assert.equal(view.getSnapshot().complete, false);
  store.commit(address, [write(a, ['amount'], 0)]);
  assert.equal(view.getSnapshot().complete, true);
});

test('nested selection aliases, structural nulls and identity changes cannot expose obsolete descendants', () => {
  const store = new StateStore();
  const view = store.watch(address, [
    field('user', [field('name', [], 'displayName'), field('email')]),
  ]);
  store.commit(address, [
    membership(a),
    { kind: 'object', record: a, path: path('user'), identity: { id: 'U1' } },
    write(a, ['user', 'name'], 'Ann'),
    write(a, ['user', 'email'], 'a@test'),
  ]);
  assert.equal(row(view).data.user.displayName, 'Ann');
  store.commit(address, [
    { kind: 'object', record: a, path: path('user'), identity: { id: 'U2' } },
    write(a, ['user', 'name'], 'Bo'),
  ]);
  assert.equal(row(view).data.user.displayName, 'Bo');
  assert.equal(Object.hasOwn(row(view).data.user, 'email'), false);
  assert.equal(view.getSnapshot().complete, false);
  store.commit(address, [write(a, ['user'], null)]);
  assert.equal(row(view).data.user, null);
  assert.equal(view.getSnapshot().complete, true);
  store.commit(address, [write(a, ['user', 'name'], 'Cy')]);
  assert.equal(row(view).data.user.displayName, 'Cy');
  assert.equal(Object.hasOwn(row(view).data.user, 'email'), false);
});

test('membership replacement is explicit; identity patches preserve order and unknown patches fail', () => {
  const store = new StateStore();
  const view = store.watch(address, [field('accountId')]);
  store.commit(address, [
    membership(a, b),
    write(a, ['accountId'], 'A'),
    write(b, ['accountId'], 'B'),
  ]);
  store.commit(address, [
    write(b, ['accountId'], 'B2'),
    write(a, ['accountId'], 'A2'),
  ]);
  assert.deepEqual(
    view.getSnapshot().records.map((r) => r.data.accountId),
    ['A2', 'B2'],
  );
  store.commit(address, [membership(b, a)]);
  assert.deepEqual(
    view.getSnapshot().records.map((r) => r.data.accountId),
    ['B2', 'A2'],
  );
  store.commit(address, [membership(a)]);
  assert.throws(
    () => store.commit(address, [write(b, ['accountId'], 'ignored')]),
    /outside known membership/,
  );
  store.commit(address, [membership(a, b)]);
  assert.equal(view.getSnapshot().records[1].data.accountId, undefined);
});

test('failed batches are atomic and successful batches notify after all projections are updated', () => {
  const store = new StateStore();
  const first = store.watch(address, [field('accountId')]);
  const second = store.watch(address, [field('accountId')]);
  store.commit(address, [membership(a), write(a, ['accountId'], 'original')]);
  const before = first.getSnapshot();
  assert.throws(
    () =>
      store.commit(address, [
        write(a, ['accountId'], 'bad'),
        write(b, ['accountId'], 'missing'),
      ]),
    /outside/,
  );
  assert.equal(first.getSnapshot(), before);
  assert.equal(second.getSnapshot().records[0].data.accountId, 'original');
  assert.throws(
    () =>
      store.commit(address, [write(a, ['accountId'], 'bad'), membership(a, a)]),
    /Duplicate/,
  );
  assert.equal(first.getSnapshot(), before);
  first.subscribe(() =>
    assert.equal(row(second).data.accountId, row(first).data.accountId),
  );
  store.commit(address, [write(a, ['accountId'], 'committed')]);
});

test('staleness and errors are field-specific, retain values, and clear on successful writes', () => {
  const store = new StateStore();
  const account = store.watch(address, [field('accountId')]);
  const amount = store.watch(address, [field('amount')]);
  store.commit(address, [
    membership(a),
    write(a, ['accountId'], 'A'),
    write(a, ['amount'], 10),
  ]);
  const unaffected = amount.getSnapshot();
  store.commit(address, [
    { kind: 'stale', record: a, path: path('accountId') },
  ]);
  assert.equal(account.getSnapshot().stale, true);
  assert.equal(account.getSnapshot().complete, true);
  assert.equal(amount.getSnapshot(), unaffected);
  store.commit(address, [
    {
      kind: 'error',
      record: a,
      path: path('accountId'),
      message: 'network unavailable',
    },
  ]);
  assert.equal(row(account).data.accountId, 'A');
  assert.equal(account.getSnapshot().complete, false);
  assert.equal(row(account).fields[0].error, 'network unavailable');
  store.commit(address, [write(a, ['accountId'], 'B')]);
  assert.equal(account.getSnapshot().stale, false);
  assert.equal(account.getSnapshot().complete, true);
  assert.equal(row(account).fields[0].error, undefined);
});

test('request coverage affects only interested consumers and concurrent request bookkeeping survives one completion', () => {
  const store = new StateStore();
  const account = store.watch(address, [field('accountId', [], 'ledger')]);
  const amount = store.watch(address, [field('amount')]);
  const unchanged = amount.getSnapshot();
  store.setFetching(address, 'one', [field('accountId')]);
  store.setFetching(address, 'two', [field('accountId')]);
  assert.equal(account.getSnapshot().fetching, true);
  assert.equal(amount.getSnapshot(), unchanged);
  store.setFetching(address, 'one');
  assert.equal(account.getSnapshot().fetching, true);
  store.setFetching(address, 'two');
  assert.equal(account.getSnapshot().fetching, false);
});

test('resource addresses and field arguments isolate state, including similarly named nested fields', () => {
  const store = new StateStore();
  const selected = [
    field('value', [], 'usd', { currency: 'USD' }),
    field('user', [field('value')]),
  ];
  const view = store.watch(address, selected);
  const other = store.watch(address + '-other', selected);
  store.commit(address, [
    membership(a),
    {
      kind: 'write',
      record: a,
      path: [{ name: 'value', arguments: { currency: 'USD' } }],
      value: 1,
    },
    write(a, ['user', 'value'], 2),
  ]);
  assert.equal(row(view).data.usd, 1);
  assert.equal(row(view).data.user.value, 2);
  assert.equal(other.getSnapshot().records, undefined);
  const before = view.getSnapshot();
  store.commit(address, [
    {
      kind: 'write',
      record: a,
      path: [{ name: 'value', arguments: { currency: 'EUR' } }],
      value: 3,
    },
  ]);
  assert.equal(view.getSnapshot(), before);
});

test('input snapshots, selection trees, identities and returned projections are immutable', () => {
  const store = new StateStore();
  const fields = [field('tags')];
  const view = store.watch(address, fields);
  fields[0].name = 'changed';
  const id = { id: '1' };
  const tags = ['a'];
  store.commit(address, [membership(id), write(id, ['tags'], tags)]);
  id.id = 'other';
  tags.push('b');
  assert.deepEqual(row(view).data.tags, ['a']);
  assert.equal(row(view).identity.id, '1');
  assert.throws(() => row(view).data.tags.push('x'), TypeError);
  assert.throws(() => {
    view.selection = [];
  }, TypeError);
  assert.throws(() => {
    row(view).identity.id = 'x';
  }, TypeError);
});

test('subscription ownership, disposal, retention and explicit eviction are independent', () => {
  const store = new StateStore();
  const first = store.watch(address, [field('accountId')]);
  const second = store.watch(address, [field('accountId')]);
  let calls = 0;
  const listener = () => calls++;
  const off = first.subscribe(listener);
  first.subscribe(listener);
  off();
  off();
  second.subscribe(listener);
  store.commit(address, [membership(a), write(a, ['accountId'], 'A')]);
  assert.equal(calls, 2);
  first.dispose();
  first.dispose();
  const frozen = first.getSnapshot();
  store.commit(address, [write(a, ['accountId'], 'B')]);
  assert.equal(calls, 3);
  assert.equal(first.getSnapshot(), frozen);
  assert.throws(() => first.subscribe(listener), /disposed/);
  assert.throws(() => store.evict(address), /active/);
  second.dispose();
  const retained = store.watch(address, [field('accountId')]);
  assert.equal(row(retained).data.accountId, 'B');
  retained.dispose();
  store.setFetching(address, 'pending', [field('accountId')]);
  assert.throws(() => store.evict(address), /active/);
  store.setFetching(address, 'pending');
  assert.equal(store.evict(address), true);
  const reset = store.watch(address, [field('accountId')]);
  assert.equal(reset.getSnapshot().records, undefined);
  store.dispose();
  store.dispose();
  assert.throws(() => store.watch(address, [field('accountId')]), /disposed/);
  assert.throws(() => store.commit(address, []), /disposed/);
  assert.throws(() => store.setFetching(address, 'x'), /disposed/);
});

test('one throwing listener does not prevent other consumers from observing committed state', () => {
  const store = new StateStore();
  const first = store.watch(address, [field('accountId')]);
  const second = store.watch(address, [field('accountId')]);
  first.subscribe(() => {
    throw new Error('UI error');
  });
  let observed;
  second.subscribe(() => {
    observed = row(second).data.accountId;
  });
  assert.throws(
    () => store.commit(address, [membership(a), write(a, ['accountId'], 'A')]),
    AggregateError,
  );
  assert.equal(observed, 'A');
  assert.equal(row(first).data.accountId, 'A');
});

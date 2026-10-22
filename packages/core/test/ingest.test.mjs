import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AcquisitionClient,
  AcquisitionSupersededError,
  ReadTransportError,
} from '../dist/index.js';

const field = (name, children = []) => ({
  name,
  responseName: name,
  arguments: {},
  children,
});
const path = (...names) => names.map((name) => ({ name, arguments: {} }));
const write = (name, value) => ({ kind: 'write', path: path(name), value });
const record = (id, fields) => ({ identity: { id }, fields });
const rows = () =>
  ['1', '2'].map((id) =>
    record(id, [write('name', `old ${id}`), write('amount', 10)]),
  );
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail('Expected asynchronous progress.');
}
function setup(t, selection = [field('name'), field('amount')], options = {}) {
  const reads = [];
  const client = new AcquisitionClient(options);
  t.after(() => client.dispose());
  const source = {
    authority: {}, // Selection wrappers below represent the same backend.
    stateAddress: 'A',
    selection,
    collection: true,
    read: (fields) =>
      new Promise((resolve, reject) => reads.push({ fields, resolve, reject })),
  };
  return { client, source, reads };
}
async function seed(f, response = rows()) {
  const handle = f.client.watch(f.source);
  await until(() => f.reads.length === 1);
  f.reads[0].resolve(response);
  await handle.ready;
  return handle;
}
const patch = (records, selection = [field('name')]) => ({
  selection,
  records,
});

test('one record patch updates shared projections without changing other records, fields or membership', async (t) => {
  const f = setup(t);
  const a = await seed(f);
  const b = f.client.watch({ ...f.source, selection: [field('name')] });
  await b.ready;
  let notices = 0;
  a.subscribe(() => {
    notices++;
    assert.equal(b.getSnapshot().records[0].data.name, 'pushed');
  });
  f.client.ingest(f.source, patch([record('1', [write('name', 'pushed')])]));
  assert.equal(notices, 1);
  assert.deepEqual(
    a.getSnapshot().records.map((r) => ({ ...r.data })),
    [
      { name: 'pushed', amount: 10 },
      { name: 'old 2', amount: 10 },
    ],
  );
  assert.equal(a.getSnapshot().membershipStale, false);
  assert.equal(f.reads.length, 1);
});

test('older reads can update untouched records and siblings, but cannot roll back a pushed field', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  const pending = assert.rejects(handle.refresh(), AcquisitionSupersededError);
  await until(() => f.reads.length === 2);
  f.client.ingest(f.source, patch([record('1', [write('name', 'event')])]));
  f.reads[1].resolve(
    ['1', '2'].map((id) =>
      record(id, [write('name', `read ${id}`), write('amount', 20)]),
    ),
  );
  await pending;
  assert.deepEqual(
    handle.getSnapshot().records.map((r) => ({ ...r.data })),
    [
      { name: 'event', amount: 20 },
      { name: 'read 2', amount: 20 },
    ],
  );
});

test('invalid patches change neither snapshots nor the eligibility of an outstanding read', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  const pending = handle.refresh('name');
  await until(() => f.reads.length === 2);
  const before = handle.getSnapshot();
  const valid = record('1', [write('name', 'bad partial commit')]);
  for (const invalid of [
    patch([valid, record('unknown', [write('name', 'unknown')])]),
    patch([valid, valid]),
    patch([record('1', [])]),
    patch([valid, record('2', [write('amount', 99)])]),
    patch([record('1', [write('name', undefined)])]),
    patch([record('1', [write('name', NaN)])]),
    patch([record('1', [write('name', 'x'), write('name', 'y')])]),
    patch([record('1', [{ kind: 'write', path: [], value: 'x' }])]),
    patch([{ identity: {}, fields: [write('name', 'x')] }]),
    { selection: [], records: [valid] },
    { selection: [field('missing')], records: [valid] },
    { selection: [field('name')], records: { kind: 'null' } },
    patch([]),
  ]) {
    assert.throws(() => f.client.ingest(f.source, invalid));
    assert.equal(handle.getSnapshot(), before);
  }
  f.reads[1].resolve(
    ['1', '2'].map((id) => record(id, [write('name', 'fresh')])),
  );
  await pending;
  assert.equal(handle.getSnapshot().records[0].data.name, 'fresh');
});

test('invalid source selection/collection cannot poison local generations', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  const pending = handle.refresh('name');
  await until(() => f.reads.length === 2);
  for (const source of [
    { ...f.source, collection: false },
    { ...f.source, selection: [{ ...field('name'), arguments: [] }] },
    { ...f.source, selection: [{ ...field('name'), responseName: '' }] },
  ])
    assert.throws(() =>
      f.client.ingest(source, patch([record('1', [write('name', 'invalid')])])),
    );
  f.reads[1].resolve(
    ['1', '2'].map((id) => record(id, [write('name', 'fresh')])),
  );
  await pending;
});

test('patches require acquired membership and active ownership; client scopes stay isolated', async (t) => {
  const f = setup(t);
  const event = patch([record('1', [write('name', 'A event')])]);
  assert.throws(() => f.client.ingest(f.source, event), /active resource/);
  const handle = f.client.watch(f.source);
  assert.throws(() => f.client.ingest(f.source, event), /acquired membership/);
  await until(() => f.reads.length === 1);
  f.reads[0].resolve(rows());
  await handle.ready;
  const other = f.client.watch({ ...f.source, stateAddress: 'B' });
  await until(() => f.reads.length === 2);
  f.reads[1].resolve(rows());
  await other.ready;
  f.client.ingest(f.source, event);
  assert.equal(other.getSnapshot().records[0].data.name, 'old 1');
  handle.dispose();
  assert.throws(() => f.client.ingest(f.source, event), /active resource/);
  f.client.dispose();
  assert.throws(() => f.client.ingest(f.source, event), /disposed/);
});

test('events cannot establish null or empty membership', async (t) => {
  for (const baseline of [{ kind: 'null' }, []]) {
    const f = setup(t);
    const handle = await seed(f, baseline);
    const before = handle.getSnapshot();
    assert.throws(() =>
      f.client.ingest(f.source, patch([record('1', [write('name', 'new')])])),
    );
    assert.equal(handle.getSnapshot(), before);
  }
});

test('explicit errors are valid events and later data patches clear only their covered errors', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  f.client.ingest(
    f.source,
    patch([
      record('1', [
        { kind: 'error', path: path('name'), message: 'server field failed' },
      ]),
    ]),
  );
  assert.equal(handle.getSnapshot().records[0].data.name, 'old 1');
  assert.equal(
    handle.getSnapshot().records[0].fields.find((f) => f.path[0] === 'name')
      .error,
    'server field failed',
  );
  assert.equal(handle.getSnapshot().error, undefined);
  f.client.ingest(f.source, patch([record('1', [write('name', 'recovered')])]));
  assert.equal(handle.getSnapshot().stale, false);
});

test('object null, identity changes and ancestor errors from events block older child resurrection', async (t) => {
  const user = field('user', [field('name'), field('nickname')]);
  for (const replacement of [
    { kind: 'write', path: path('user'), value: null },
    { kind: 'object', path: path('user'), identity: { id: 'new-user' } },
    { kind: 'error', path: path('user'), message: 'failed branch' },
  ]) {
    const f = setup(t, [user]);
    const oldObject = {
      kind: 'object',
      path: path('user'),
      identity: { id: 'old-user' },
    };
    const handle = await seed(f, [
      record('1', [
        oldObject,
        { kind: 'write', path: path('user', 'name'), value: 'old name' },
        { kind: 'write', path: path('user', 'nickname'), value: 'old nick' },
      ]),
    ]);
    const pending = assert.rejects(
      handle.refresh('user.nickname'),
      AcquisitionSupersededError,
    );
    await until(() => f.reads.length === 2);
    const before = handle.getSnapshot();
    assert.throws(
      () =>
        f.client.ingest(
          f.source,
          patch([record('1', [write('user', {})])], [field('user')]),
        ),
      /children/,
    );
    assert.equal(handle.getSnapshot(), before);
    f.client.ingest(
      f.source,
      patch(
        [
          record(
            '1',
            replacement.kind === 'object'
              ? [
                  replacement,
                  { kind: 'write', path: path('user', 'name'), value: 'new' },
                ]
              : [replacement],
          ),
        ],
        [field('user', [field('name')])],
      ),
    );
    const afterEvent = handle.getSnapshot().records[0].data.user;
    f.reads[1].resolve([
      record('1', [
        oldObject,
        { kind: 'write', path: path('user', 'nickname'), value: 'obsolete' },
      ]),
    ]);
    await pending;
    assert.deepEqual(handle.getSnapshot().records[0].data.user, afterEvent);
  }
});

test('events protect against older omissions, errors and list replacement', async (t) => {
  for (const mode of ['omission', 'error', 'list']) {
    const f = setup(t);
    const handle = await seed(f);
    const pending = assert.rejects(
      mode === 'list' ? handle.refreshList() : handle.refresh('name'),
      AcquisitionSupersededError,
    );
    await until(() => f.reads.length === 2);
    f.client.ingest(f.source, patch([record('1', [write('name', 'event')])]));
    f.reads[1].resolve(
      mode === 'list'
        ? []
        : [
            record(
              '1',
              mode === 'omission'
                ? []
                : [{ kind: 'error', path: path('name'), message: 'old error' }],
            ),
            record('2', [write('name', 'read 2')]),
          ],
    );
    await pending;
    assert.equal(handle.getSnapshot().records[0].data.name, 'event');
    assert.equal(
      handle.getSnapshot().records[0].fields.find((f) => f.path[0] === 'name')
        .stale,
      false,
    );
  }
});

test('an event during backoff suppresses the older retry chain', async (t) => {
  let release;
  const f = setup(t, undefined, {
    retry: {},
    scheduler: {
      random: () => 0.5,
      wait: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
  });
  const handle = await seed(f);
  const pending = assert.rejects(
    handle.refresh('name'),
    AcquisitionSupersededError,
  );
  await until(() => f.reads.length === 2);
  f.reads[1].reject(new ReadTransportError('offline', { retryable: true }));
  await until(() => release !== undefined);
  f.client.ingest(f.source, patch([record('1', [write('name', 'event')])]));
  release();
  await pending;
  assert.equal(f.reads.length, 2);
  assert.equal(handle.getSnapshot().records[0].data.name, 'event');
});

test('reentrant event delivery and disposal preserve the newer atomic commit', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  handle.subscribe(() => {
    if (handle.getSnapshot().records[0].data.name === 'first') {
      f.client.ingest(
        f.source,
        patch([record('1', [write('name', 'second')])]),
      );
      handle.dispose();
    }
  });
  f.client.ingest(f.source, patch([record('1', [write('name', 'first')])]));
  assert.equal(handle.getSnapshot().records[0].data.name, 'second');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AcquisitionClient,
  ReadTransportError,
  ReadTimeoutError,
} from '../dist/index.js';

const field = (name, children = [], responseName = name, args = {}) => ({
  name,
  responseName,
  arguments: args,
  children,
});
const fields = [field('name'), field('amount')];
const path = (...names) => names.map((name) => ({ name, arguments: {} }));
const write = (name, value) => ({
  kind: 'write',
  path: path(...name.split('.')),
  value,
});
const row = (values, id = '1') => ({
  identity: { id },
  fields: Object.entries(values).map(([key, value]) => write(key, value)),
});
const flush = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};
function clock() {
  let now = 0;
  const timers = new Set(),
    all = [];
  const scheduler = {
    now: () => now,
    random: () => 0.5,
    wait(ms, signal) {
      return new Promise((resolve, reject) => {
        const timer = {
          at: now + ms,
          signal,
          fire: () => {
            unsubscribe();
            timers.delete(timer);
            resolve();
          },
          reject,
        };
        const unsubscribe = signal.subscribe(() => {
          timers.delete(timer);
          reject(signal.reason);
        });
        if (!signal.aborted) timers.add(timer);
        all.push(timer);
      });
    },
  };
  return {
    scheduler,
    timers,
    all,
    async advance(ms) {
      const end = now + ms;
      for (let count = 0; count < 100; count++) {
        const next = [...timers]
          .filter((t) => t.at <= end)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) {
          now = end;
          await flush();
          return;
        }
        now = next.at;
        next.fire();
        await flush();
      }
      throw new Error('Timer loop');
    },
  };
}
function setup(
  t,
  {
    freshness = { staleTimeMs: 100 },
    options = {},
    selection = fields,
    collection = false,
  } = {},
) {
  const time = clock();
  const client = new AcquisitionClient({
    freshnessScheduler: time.scheduler,
    requestPolicy: { freshness },
    ...options,
  });
  t.after(() => client.dispose());
  const reads = [];
  const source = {
    authority: {}, // Selection wrappers below represent the same backend.
    stateAddress: 'one',
    selection,
    collection,
    read(selection, { signal }) {
      return new Promise((resolve, reject) =>
        reads.push({ selection, signal, resolve, reject }),
      );
    },
  };
  return { client, source, reads, ...time };
}
async function seed(f, data = [row({ name: 'old', amount: 10 })]) {
  const handle = f.client.watch(f.source);
  await flush();
  f.reads[0].resolve(data);
  await handle.ready;
  return handle;
}
const names = (read) => read.selection.map((f) => f.name);

test('expiry preserves values, completeness and snapshot identity until the boundary; on-demand reacquires membership', async (t) => {
  const f = setup(t, { collection: true }),
    a = await seed(f),
    b = f.client.watch(f.source);
  await b.ready;
  const fresh = a.getSnapshot();
  await f.advance(99);
  assert.equal(a.getSnapshot(), fresh);
  await f.advance(1);
  assert.equal(a.getSnapshot().stale, true);
  assert.equal(a.getSnapshot().complete, true);
  assert.equal(a.getSnapshot().records[0].data.name, 'old');
  assert.equal(b.getSnapshot().membershipStale, true);
  assert.equal(f.reads.length, 1);
  const work = a.ensure();
  await flush();
  f.reads[1].resolve([row({ name: 'new', amount: 20 }, '2')]);
  await work;
  assert.equal(a.getSnapshot().records[0].identity.id, '2');
  assert.equal(b.getSnapshot().stale, false);
});
test('only accepted field coverage renews; membership and independent fields retain their own ages', async (t) => {
  const f = setup(t, { collection: true }),
    a = await seed(f);
  await f.advance(50);
  const refresh = a.refresh('name');
  await flush();
  f.reads[1].resolve([row({ name: 'new' })]);
  await refresh;
  await f.advance(50);
  const snapshot = a.getSnapshot();
  assert.equal(snapshot.membershipStale, true);
  assert.equal(
    snapshot.records[0].fields.find((f) => f.path[0] === 'name').stale,
    false,
  );
  assert.equal(
    snapshot.records[0].fields.find((f) => f.path[0] === 'amount').stale,
    true,
  );
  await f.advance(50);
  assert.equal(
    a.getSnapshot().records[0].fields.find((s) => s.path[0] === 'name').stale,
    true,
  );
});
test('field-only expiry requests only stale fields after membership renewal by a narrow owner', async (t) => {
  const f = setup(t, { collection: true }),
    wide = await seed(f);
  await f.advance(50);
  const narrow = f.client.watch({ ...f.source, selection: [fields[0]] });
  await narrow.ready;
  const refresh = narrow.refreshList();
  await flush();
  f.reads[1].resolve([row({ name: 'new' })]);
  await refresh;
  await f.advance(50);
  assert.equal(wide.getSnapshot().membershipStale, false);
  const work = wide.ensure();
  await flush();
  assert.deepEqual(names(f.reads[2]), ['amount']);
  f.reads[2].resolve([row({ amount: 20 })]);
  await work;
  assert.equal(wide.getSnapshot().stale, false);
});
test('active owners share one expiry acquisition; failures do not create repeated work', async (t) => {
  const f = setup(t, { freshness: { staleTimeMs: 100, revalidate: 'active' } }),
    a = await seed(f),
    b = f.client.watch(f.source);
  await b.ready;
  await f.advance(100);
  assert.equal(f.reads.length, 2);
  f.reads[1].reject(new ReadTransportError('offline', { retryable: false }));
  await flush();
  assert.equal(a.getSnapshot().error, 'offline');
  assert.equal(b.getSnapshot().error, 'offline');
  await f.advance(1000);
  assert.equal(f.reads.length, 2);
  assert.equal(f.timers.size, 0);
  const work = a.ensure();
  await flush();
  f.reads[2].resolve([row({ name: 'recovered', amount: 30 })]);
  await work;
  await f.advance(100);
  assert.equal(f.reads.length, 4);
});
test('expiry of old values does not supersede a refresh already in flight', async (t) => {
  const f = setup(t, { freshness: { staleTimeMs: 100, revalidate: 'active' } }),
    a = await seed(f);
  await f.advance(90);
  const work = a.refresh();
  await flush();
  await f.advance(10);
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve([row({ name: 'new', amount: 20 })]);
  await work;
  await flush();
  // A singleton field read must also revalidate expired membership once, then settle.
  if (f.reads[2]) {
    f.reads[2].resolve([row({ name: 'new', amount: 20 })]);
    await flush();
  }
  assert.equal(a.getSnapshot().stale, false);
});
test('zero TTL allows one shared initial read and one read per later ensure without looping', async (t) => {
  const f = setup(t, { freshness: { staleTimeMs: 0 }, collection: true });
  const a = f.client.watch(f.source),
    b = f.client.watch(f.source);
  await flush();
  assert.equal(f.reads.length, 1);
  f.reads[0].resolve([row({ name: 'zero', amount: 10 })]);
  await Promise.all([a.ready, b.ready]);
  await flush();
  assert.equal(f.reads.length, 1);
  assert.equal(a.getSnapshot().stale, true);
  assert.equal(f.timers.size, 0);
  const work = a.ensure();
  await flush();
  f.reads[1].resolve([row({ name: 'next', amount: 20 })]);
  await work;
  assert.equal(f.reads.length, 2);
});
test('an explicit invalidation during a zero-TTL read is not mistaken for satisfied coverage', async (t) => {
  const f = setup(t, { freshness: { staleTimeMs: 0 } }),
    a = f.client.watch(f.source);
  await flush();
  const b = f.client.watch(f.source);
  await flush();
  await a.invalidate('name', { refetch: 'none' });
  f.reads[0].resolve([row({ name: 'old', amount: 10 })]);
  await a.ready;
  await flush();
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve([row({ name: 'new', amount: 20 })]);
  await b.ready;
});
test('null and empty resources expire and reacquire without losing shape', async (t) => {
  for (const data of [{ kind: 'null' }, []]) {
    const f = setup(t, { collection: true }),
      a = await seed(f, data);
    await f.advance(100);
    assert.equal(a.getSnapshot().records === null, data.kind === 'null');
    assert.equal(a.getSnapshot().complete, true);
    const work = a.ensure();
    await flush();
    f.reads[1].resolve([row({ name: 'arrived', amount: 5 })]);
    await work;
    assert.equal(a.getSnapshot().records[0].identity.id, '1');
  }
});
test('structural null expires at its parent; context objects never renew sibling leaves', async (t) => {
  const selection = [field('user', [field('name'), field('age')])];
  const f = setup(t, { selection }),
    a = await seed(f, [row({ user: null })]);
  await f.advance(50);
  const work = a.refresh('user.name');
  await flush();
  f.reads[1].resolve([
    {
      identity: { id: '1' },
      fields: [
        { kind: 'object', path: path('user'), identity: { id: 'u' } },
        write('user.name', 'new'),
      ],
    },
  ]);
  await work;
  await f.advance(50);
  assert.equal(
    a
      .getSnapshot()
      .records[0].fields.find((s) => s.path.join('.') === 'user.name').stale,
    false,
  );
  await f.advance(50);
  assert.equal(
    a
      .getSnapshot()
      .records[0].fields.find((s) => s.path.join('.') === 'user.name').stale,
    true,
  );
});
test('inactive resources release timers and check elapsed age on reattachment; delayed callbacks are ignored', async (t) => {
  const f = setup(t),
    a = await seed(f);
  const old = [...f.timers][0];
  await f.advance(20);
  a.dispose();
  assert.equal(f.timers.size, 0);
  await f.advance(200);
  const b = f.client.watch(f.source);
  await flush();
  assert.equal(b.getSnapshot().stale, true);
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve([row({ name: 'fresh', amount: 20 })]);
  await b.ready;
  old.fire();
  await flush();
  assert.equal(b.getSnapshot().stale, false);
  f.client.dispose();
  assert.equal(f.timers.size, 0);
});
test('active expiry never fetches cached fields without active interest', async (t) => {
  const f = setup(t, {
      freshness: { staleTimeMs: 100, revalidate: 'active' },
      collection: true,
    }),
    wide = await seed(f);
  const narrow = f.client.watch({ ...f.source, selection: [fields[0]] });
  await narrow.ready;
  wide.dispose();
  await f.advance(100);
  assert.equal(f.reads.length, 2);
  assert.deepEqual(names(f.reads[1]), ['name']);
  f.reads[1].resolve([row({ name: 'new' })]);
  await flush();
  assert.equal(narrow.getSnapshot().stale, false);
});
test('whole-resource fetched context cannot renew uncommitted fields', async (t) => {
  const f = setup(t);
  f.source.fetchSelection = () => fields;
  const a = await seed(f);
  await f.advance(50);
  const work = a.refresh('name');
  await flush();
  f.reads[1].resolve([row({ name: 'new', amount: 999 })]);
  await work;
  await f.advance(50);
  assert.equal(a.getSnapshot().records[0].data.amount, 10);
  assert.equal(
    a.getSnapshot().records[0].fields.find((s) => s.path[0] === 'amount').stale,
    true,
  );
});
test('ingested accepted patches renew only their own coverage, including same-value writes', async (t) => {
  const f = setup(t),
    a = await seed(f);
  await f.advance(50);
  f.client.ingest(f.source, {
    selection: [fields[0]],
    records: [row({ name: 'old' })],
  });
  await f.advance(50);
  assert.equal(
    a.getSnapshot().records[0].fields.find((s) => s.path[0] === 'name').stale,
    false,
  );
  assert.equal(
    a.getSnapshot().records[0].fields.find((s) => s.path[0] === 'amount').stale,
    true,
  );
});
test('scheduler rejection fails closed and does not launch active recovery or leave unhandled work', async (t) => {
  const f = setup(t, { freshness: { staleTimeMs: 100, revalidate: 'active' } }),
    a = await seed(f);
  [...f.timers][0].reject(new Error('clock failed'));
  await flush();
  assert.equal(a.getSnapshot().stale, true);
  assert.equal(a.getSnapshot().error, 'clock failed');
  assert.equal(f.reads.length, 1);
});
test('deadline during active expiry leaves cached values stale and stops until explicit demand', async (t) => {
  const time = clock();
  const f = setup(t, {
    freshness: { staleTimeMs: 100, revalidate: 'active' },
    options: {
      freshnessScheduler: time.scheduler,
      deadlineScheduler: time.scheduler,
      requestPolicy: {
        requestTimeoutMs: 30,
        freshness: { staleTimeMs: 100, revalidate: 'active' },
      },
    },
  });
  const a = await seed(f);
  await time.advance(100);
  assert.equal(f.reads.length, 2);
  await time.advance(30);
  assert.match(a.getSnapshot().error, /deadline/);
  assert.equal(f.reads[1].signal.aborted, true);
  await time.advance(1000);
  assert.equal(f.reads.length, 2);
});
test('freshness policies inherit immutably and conflict before adding ownership', async (t) => {
  const time = clock();
  const policy = { freshness: { staleTimeMs: 100, revalidate: 'active' } };
  const client = new AcquisitionClient({
    freshnessScheduler: time.scheduler,
    requestPolicy: policy,
    requestPolicyGroups: {
      forms: { freshness: { staleTimeMs: 50 } },
      off: { freshness: { staleTimeMs: false } },
    },
  });
  t.after(() => client.dispose());
  policy.freshness.staleTimeMs = 999;
  const source = {
    stateAddress: 'x',
    selection: fields,
    read: async () => [row({ name: 'x', amount: 1 })],
  };
  const a = client.watch(source, {
    group: 'forms',
    requestPolicy: { freshness: { revalidate: 'on-demand' } },
  });
  await a.ready;
  assert.throws(() => client.watch(source), /same effective freshness/);
  assert.throws(
    () => client.watch(source, { group: 'off' }),
    /same effective freshness/,
  );
  await time.advance(50);
  assert.equal(a.getSnapshot().stale, true);
});
test('disabled expiry needs no clock; invalid settings and clocks fail before source execution', async (t) => {
  let reads = 0;
  const source = {
    stateAddress: 'x',
    selection: fields,
    read: async () => {
      reads++;
      return [row({ name: 'x', amount: 1 })];
    },
  };
  const client = new AcquisitionClient();
  t.after(() => client.dispose());
  const a = client.watch(source);
  await a.ready;
  assert.equal(a.getSnapshot().stale, false);
  for (const staleTimeMs of [-1, 0.5, NaN, Infinity, '100', null, 2147483648])
    assert.throws(
      () =>
        new AcquisitionClient({
          requestPolicy: { freshness: { staleTimeMs } },
        }),
      /staleTimeMs/,
    );
  for (const freshness of [
    { staleTimeMs: 0, revalidate: 'active' },
    { staleTimeMs: 10 },
  ]) {
    const invalid = new AcquisitionClient({ requestPolicy: { freshness } });
    assert.throws(() => invalid.watch(source), /positive|freshnessScheduler/);
    invalid.dispose();
  }
  const badClock = new AcquisitionClient({
    freshnessScheduler: { now: () => NaN, wait: async () => {} },
    requestPolicy: { freshness: { staleTimeMs: 1 } },
  });
  assert.throws(() => badClock.watch(source), /finite/);
  badClock.dispose();
  assert.equal(reads, 1);
});

test('clock failure between source read and commit marks the whole accepted batch stale atomically', async (t) => {
  let broken = false;
  const time = clock();
  const f = setup(t, {
    options: {
      freshnessScheduler: {
        now: () => {
          if (broken) throw Error('now failed');
          return time.scheduler.now();
        },
        wait: time.scheduler.wait,
      },
    },
  });
  const a = await seed(f);
  const work = a.refresh('name');
  await flush();
  broken = true;
  f.reads[1].resolve([row({ name: 'new' })]);
  await work;
  assert.equal(a.getSnapshot().records[0].data.name, 'new');
  assert.equal(a.getSnapshot().stale, true);
  assert.equal(a.getSnapshot().membershipStale, true);
  assert.equal(a.getSnapshot().error, 'now failed');
  assert.equal(time.timers.size, 0);
  assert.ok(a.getSnapshot().records[0].fields.every((field) => field.stale));
});

test('failed nulls and partial errors remain stale without a new successful-age timer', async (t) => {
  const f = setup(t, { freshness: { staleTimeMs: 100, revalidate: 'active' } }),
    a = await seed(f);
  const work = a.refresh();
  await flush();
  f.reads[1].resolve({ kind: 'null', error: 'denied' });
  await assert.rejects(work, /denied/);
  assert.equal(a.getSnapshot().records, null);
  assert.equal(f.timers.size, 0);
  await f.advance(200);
  assert.equal(f.reads.length, 2);
});

test('expiry preserves retry eligibility and one shared retry chain', async (t) => {
  const time = clock();
  const f = setup(t, {
    freshness: { staleTimeMs: 100, revalidate: 'active' },
    options: {
      freshnessScheduler: time.scheduler,
      scheduler: time.scheduler,
      retry: { retries: 1, initialDelayMs: 100 },
    },
  });
  const a = await seed(f);
  await time.advance(90);
  const work = a.refresh();
  await flush();
  f.reads[1].reject(new ReadTransportError('retry', { retryable: true }));
  await flush();
  await time.advance(10);
  assert.equal(f.reads.length, 2);
  await time.advance(40);
  assert.equal(f.reads.length, 3);
  f.reads[2].resolve([row({ name: 'new', amount: 20 })]);
  await work;
  await flush();
  if (f.reads[3]) {
    f.reads[3].resolve([row({ name: 'new', amount: 20 })]);
    await flush();
  }
  assert.equal(a.getSnapshot().stale, false);
});

test('record deletion and identity replacement discard obsolete field timers', async (t) => {
  const f = setup(t, { collection: true }),
    a = await seed(f);
  await f.advance(50);
  const work = a.refreshList();
  await flush();
  f.reads[1].resolve([row({ name: 'replacement', amount: 2 }, '2')]);
  await work;
  await f.advance(50);
  assert.equal(a.getSnapshot().stale, false);
  assert.equal(a.getSnapshot().records[0].identity.id, '2');
  await f.advance(50);
  assert.equal(a.getSnapshot().stale, true);
});

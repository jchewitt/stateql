import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AcquisitionClient, ReadTransportError } from '../dist/index.js';

const field = (name, responseName = name, args = {}, children = []) => ({
  name,
  responseName,
  arguments: args,
  children,
});
const fields = [field('name'), field('amount')];
const row = (values, id = '1') => ({
  identity: { id },
  fields: Object.entries(values).map(([name, value]) => ({
    kind: 'write',
    path: [{ name, arguments: {} }],
    value,
  })),
});
const names = (read) => read.selection.map((selected) => selected.name);
const flush = async () => {
  for (let i = 0; i < 80; i++) await Promise.resolve();
};
function clock() {
  let now = 0;
  const timers = new Set();
  const all = [];
  const scheduler = {
    now: () => now,
    random: () => 0.5,
    wait(ms, signal) {
      return new Promise((resolve, reject) => {
        const timer = {
          at: now + ms,
          signal,
          fire() {
            unsubscribe();
            timers.delete(timer);
            resolve();
          },
          fail(error) {
            unsubscribe();
            timers.delete(timer);
            reject(error);
          },
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
    jump(ms) {
      now += ms;
    },
    async advance(ms) {
      const end = now + ms;
      for (let count = 0; count < 100; count++) {
        const next = [...timers]
          .filter((timer) => timer.at <= end)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) {
          now = end;
          await flush();
          return;
        }
        now = Math.max(now, next.at);
        next.fire();
        await flush();
      }
      throw new Error('Unbounded timer loop');
    },
  };
}
function setup(
  t,
  options = {},
  { collection = false, selection = fields } = {},
) {
  const time = clock();
  const client = new AcquisitionClient({
    pollingScheduler: time.scheduler,
    ...options,
  });
  t.after(() => client.dispose());
  const reads = [];
  const source = {
    authority: {},
    stateAddress: 'one',
    collection,
    selection,
    read(selection, { signal }) {
      return new Promise((resolve, reject) => {
        reads.push({ selection, signal, resolve, reject });
      });
    },
  };
  return { client, source, reads, ...time };
}
async function seed(f, data = [row({ name: 'old', amount: 10 })], options) {
  const handle = f.client.watch(f.source, options);
  await flush();
  f.reads[0].resolve(data);
  await handle.ready;
  return handle;
}

test('configuration never starts polling; explicit disabled interests are inert', async (t) => {
  const f = setup(t, { requestPolicy: { polling: { everyMs: 100 } } });
  const handle = await seed(f);
  await f.advance(1000);
  assert.equal(f.reads.length, 1);
  assert.equal(f.timers.size, 0);
  const stop = handle.poll({ everyMs: false });
  stop();
  stop();
  await f.advance(1000);
  assert.equal(f.reads.length, 1);
  handle.poll({ target: 'name' });
  await f.advance(99);
  assert.equal(f.reads.length, 1);
  await f.advance(1);
  assert.deepEqual(names(f.reads[1]), ['name']);
});

test('polling cadence restarts after settlement without accumulating missed ticks', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  handle.poll({ target: 'name', everyMs: 100 });
  await f.advance(100);
  assert.equal(f.reads.length, 2);
  await f.advance(1000);
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve([row({ name: 'new' })]);
  await flush();
  await f.advance(99);
  assert.equal(f.reads.length, 2);
  await f.advance(1);
  assert.equal(f.reads.length, 3);
  assert.equal(handle.getSnapshot().records[0].data.amount, 10);
});

test('identical interests share the fastest cadence and stopping it restores the remaining cadence', async (t) => {
  const f = setup(t);
  const a = await seed(f);
  const b = f.client.watch(f.source);
  await b.ready;
  a.poll({ target: 'name', everyMs: 100 });
  const stopFast = b.poll({ target: 'name', everyMs: 30 });
  await f.advance(30);
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve([row({ name: 'fast' })]);
  await flush();
  stopFast();
  await f.advance(99);
  assert.equal(f.reads.length, 2);
  await f.advance(1);
  assert.deepEqual(names(f.reads[2]), ['name']);
});

test('stopping one same-owner interest between a due timer and dispatch preserves its surviving peer', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  handle.poll({ target: 'name', everyMs: 20 });
  const stopLast = handle.poll({ target: 'name', everyMs: 20 });
  f.jump(20);
  [...f.timers][0].fire();
  // The timer has queued its tick, but the owner has not dispatched its read.
  await Promise.resolve();
  stopLast();
  await flush();
  assert.equal(f.reads.length, 2);
  assert.deepEqual(names(f.reads[1]), ['name']);
  f.reads[1].resolve([row({ name: 'survived' })]);
  await flush();
  assert.equal(handle.getSnapshot().records[0].data.name, 'survived');
});

test('aliases share canonical polling interests while independently selected fields keep separate cadences', async (t) => {
  const f = setup(t);
  const a = await seed(f);
  const b = f.client.watch({
    ...f.source,
    selection: [field('name', 'displayName')],
  });
  await b.ready;
  a.poll({ target: 'name', everyMs: 20 });
  b.poll({ target: 'displayName', everyMs: 20 });
  a.poll({ target: 'amount', everyMs: 35 });
  await f.advance(20);
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve([row({ name: 'shared' })]);
  await flush();
  assert.equal(b.getSnapshot().records[0].data.displayName, 'shared');
  await f.advance(15);
  assert.equal(f.reads.length, 3);
  assert.deepEqual(names(f.reads[2]), ['amount']);
  await f.advance(5);
  assert.equal(f.reads.length, 4);
  assert.deepEqual(names(f.reads[3]), ['name']);
});

test('a due field poll joins a successful broad pending refresh without an extra read', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  handle.poll({ target: 'name', everyMs: 20 });
  const broad = handle.refresh();
  await flush();
  await f.advance(20);
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve([row({ name: 'broad', amount: 20 })]);
  await broad;
  await flush();
  assert.equal(f.reads.length, 2);
  await f.advance(20);
  assert.deepEqual(names(f.reads[2]), ['name']);
});

test('a joined root request only satisfies its requested fields, not the whole resource', async (t) => {
  const f = setup(t, {}, { collection: true });
  f.source.fetchSelection = () => fields;
  const wide = await seed(f);
  // A separately projected source can still fetch broader fields through its adapter.
  const rootSource = { ...f.source, selection: [fields[0]] };
  delete rootSource.fetchSelection;
  const root = f.client.watch(rootSource);
  await root.ready;
  wide.poll({ target: 'amount', everyMs: 20 });
  const refresh = root.refreshList();
  await flush();
  await f.advance(20);
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve([row({ name: 'root' })]);
  await refresh;
  await flush();
  assert.equal(f.reads.length, 3);
  // Whole-resource transport expansion must not be mistaken for commit coverage.
  assert.deepEqual(names(f.reads[2]).sort(), ['amount', 'name']);
  f.reads[2].resolve([row({ name: 'unrequested', amount: 20 })]);
  await flush();
  assert.equal(wide.getSnapshot().records[0].data.name, 'root');
  assert.equal(wide.getSnapshot().records[0].data.amount, 20);
});

test('whole-resource fetch coverage does not suppress a separate field polling interest', async (t) => {
  const f = setup(t);
  f.source.fetchSelection = () => fields;
  const handle = await seed(f);
  handle.poll({ target: 'amount', everyMs: 20 });
  const manual = handle.refresh('name');
  await flush();
  await f.advance(20);
  assert.equal(f.reads.length, 3);
  f.reads[1].resolve([row({ name: 'manual', amount: -1 })]);
  await manual;
  f.reads[2].resolve([row({ name: 'unrequested', amount: 20 })]);
  await flush();
  assert.equal(handle.getSnapshot().records[0].data.name, 'manual');
  assert.equal(handle.getSnapshot().records[0].data.amount, 20);
});

test('canonical polling groups retain field arguments and nested paths', async (t) => {
  const usd = field('value', 'usd', { currency: 'USD' });
  const eur = field('value', 'eur', { currency: 'EUR' });
  const selection = [field('account', 'account', {}, [usd])];
  const f = setup(t, {}, { selection });
  const amount = (currency, value) => ({
    kind: 'write',
    path: [
      { name: 'account', arguments: {} },
      { name: 'value', arguments: { currency } },
    ],
    value,
  });
  const handle = await seed(f, [
    {
      identity: { id: '1' },
      fields: [
        { kind: 'object', path: [{ name: 'account', arguments: {} }] },
        amount('USD', 10),
      ],
    },
  ]);
  const other = f.client.watch({
    ...f.source,
    selection: [field('account', 'account', {}, [eur])],
  });
  await flush();
  f.reads[1].resolve([{ identity: { id: '1' }, fields: [amount('EUR', 20)] }]);
  await other.ready;
  handle.poll({ target: 'account.usd', everyMs: 20 });
  other.poll({ target: 'account.eur', everyMs: 30 });
  await f.advance(20);
  assert.equal(f.reads.length, 3);
  assert.equal(f.reads[2].selection[0].children[0].arguments.currency, 'USD');
  await f.advance(10);
  assert.equal(f.reads.length, 4);
  assert.equal(f.reads[3].selection[0].children[0].arguments.currency, 'EUR');
  f.reads[2].resolve([{ identity: { id: '1' }, fields: [amount('USD', 11)] }]);
  f.reads[3].resolve([{ identity: { id: '1' }, fields: [amount('EUR', 21)] }]);
  await flush();
  assert.equal(handle.getSnapshot().records[0].data.account.usd, 11);
  assert.equal(other.getSnapshot().records[0].data.account.eur, 21);
});

test('polls serialize with overlapping poll selections but manual refresh remains forced', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  handle.poll({ everyMs: 20 });
  handle.poll({ target: 'name', everyMs: 20 });
  await f.advance(20);
  assert.equal(f.reads.length, 2);
  const manual = handle.refresh('name');
  await flush();
  assert.equal(f.reads.length, 3);
  f.reads[2].resolve([row({ name: 'manual' })]);
  await manual;
  f.reads[1].resolve([row({ name: 'old', amount: 20 })]);
  await flush();
  assert.equal(handle.getSnapshot().records[0].data.name, 'manual');
});

test('polls share an existing retry chain; joined failure waits another cadence before retrying', async (t) => {
  const time = clock();
  const f = setup(t, {
    pollingScheduler: time.scheduler,
    scheduler: time.scheduler,
    retry: { retries: 1, initialDelayMs: 100 },
  });
  const handle = await seed(f);
  handle.poll({ target: 'name', everyMs: 20 });
  const manual = handle.refresh('name');
  const failed = assert.rejects(manual, /exhausted/);
  await flush();
  f.reads[1].reject(new ReadTransportError('first', { retryable: true }));
  await flush();
  await time.advance(20);
  assert.equal(f.reads.length, 2);
  await time.advance(30);
  assert.equal(f.reads.length, 3);
  f.reads[2].reject(new ReadTransportError('exhausted', { retryable: true }));
  await failed;
  await flush();
  assert.match(handle.getSnapshot().error, /exhausted/);
  assert.equal(f.reads.length, 3);
  await time.advance(19);
  assert.equal(f.reads.length, 3);
  await time.advance(1);
  assert.equal(f.reads.length, 4);
  f.reads[3].resolve([row({ name: 'recovered' })]);
  await flush();
  assert.equal(handle.getSnapshot().error, undefined);
});

test('poll deadlines abort hung reads, retain values, and recover on the next cadence', async (t) => {
  const time = clock();
  const f = setup(t, {
    pollingScheduler: time.scheduler,
    deadlineScheduler: time.scheduler,
    requestPolicy: { requestTimeoutMs: 30 },
  });
  const handle = await seed(f);
  handle.poll({ target: 'name', everyMs: 20 });
  await time.advance(20);
  await time.advance(30);
  assert.equal(f.reads[1].signal.aborted, true);
  assert.match(handle.getSnapshot().error, /deadline/);
  assert.equal(handle.getSnapshot().records[0].data.name, 'old');
  await time.advance(20);
  assert.equal(f.reads.length, 3);
  f.reads[2].resolve([row({ name: 'recovered' })]);
  await flush();
  assert.equal(handle.getSnapshot().error, undefined);
});

test('partial poll errors affect only the requested field and the next successful tick clears them', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  handle.poll({ target: 'name', everyMs: 20 });
  await f.advance(20);
  f.reads[1].resolve([
    {
      identity: { id: '1' },
      fields: [
        {
          kind: 'error',
          path: [{ name: 'name', arguments: {} }],
          message: 'field unavailable',
        },
      ],
    },
  ]);
  await flush();
  const snapshot = handle.getSnapshot();
  assert.match(snapshot.error, /field unavailable/);
  assert.equal(snapshot.records[0].data.name, 'old');
  assert.equal(snapshot.records[0].data.amount, 10);
  assert.equal(
    snapshot.records[0].fields.find((status) => status.path[0] === 'amount')
      .error,
    undefined,
  );
  await f.advance(20);
  f.reads[2].resolve([row({ name: 'restored' })]);
  await flush();
  assert.equal(handle.getSnapshot().error, undefined);
  assert.equal(
    handle
      .getSnapshot()
      .records[0].fields.find((status) => status.path[0] === 'name').error,
    undefined,
  );
});

test('stopping and replacing an interest during an existing read does not create an overlapping retry chain', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  const stop = handle.poll({ target: 'name', everyMs: 20 });
  await f.advance(20);
  stop();
  handle.poll({ target: 'name', everyMs: 10 });
  await f.advance(10);
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve([row({ name: 'joined' })]);
  await flush();
  assert.equal(f.reads.length, 2);
  await f.advance(9);
  assert.equal(f.reads.length, 2);
  await f.advance(1);
  assert.equal(f.reads.length, 3);
});

test('a stopped queued poll cannot hide the terminal error of a pending manual read', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  const manual = handle.refresh('name');
  const rejected = assert.rejects(manual, /manual read failed/);
  await flush();
  const stop = handle.poll({ target: 'name', everyMs: 20 });
  f.jump(20);
  [...f.timers][0].fire();
  await Promise.resolve();
  await Promise.resolve();
  // Stop during dispatch: either the poll has joined the read, or it must leave
  // the pending manual attempt's error reporting intact when skipping its work.
  stop();
  await flush();
  assert.equal(f.reads.length, 2);
  f.reads[1].reject(new Error('manual read failed'));
  await rejected;
  await flush();
  assert.equal(handle.getSnapshot().error, 'manual read failed');
  assert.equal(f.timers.size, 0);
});

test('an older poll failure cannot overwrite a newer manual command outcome', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  const stop = handle.poll({ target: 'name', everyMs: 20 });
  await f.advance(20);
  const manual = handle.refresh('amount');
  await flush();
  assert.equal(f.reads.length, 3);
  f.reads[2].resolve([row({ amount: 20 })]);
  await manual;
  f.reads[1].reject(new Error('older poll failed'));
  await flush();
  stop();
  assert.equal(handle.getSnapshot().error, undefined);
  assert.equal(handle.getSnapshot().records[0].data.amount, 20);
});

test('stopping an interest does not cancel its current read or another query owner', async (t) => {
  const f = setup(t);
  const a = await seed(f);
  const b = f.client.watch(f.source);
  await b.ready;
  const stop = a.poll({ target: 'name', everyMs: 20 });
  await f.advance(20);
  stop();
  stop();
  a.dispose();
  assert.equal(f.reads[1].signal.aborted, false);
  f.reads[1].resolve([row({ name: 'shared' })]);
  await flush();
  assert.equal(b.getSnapshot().records[0].data.name, 'shared');
  await f.advance(1000);
  assert.equal(f.reads.length, 2);
  assert.equal(f.timers.size, 0);
});

test('handle and client disposal release all polling interests and retained timer callbacks cannot revive them', async (t) => {
  const f = setup(t);
  const a = await seed(f);
  a.poll({ target: 'name', everyMs: 20 });
  a.poll({ target: 'amount', everyMs: 30 });
  const retained = [...f.timers];
  a.dispose();
  assert.equal(f.timers.size, 0);
  for (const timer of retained) timer.fire();
  await flush();
  assert.equal(f.reads.length, 1);
  assert.throws(() => a.poll({ everyMs: 20 }), /disposed/);
  const b = f.client.watch(f.source);
  await b.ready;
  b.poll({ everyMs: 20 });
  const late = [...f.timers];
  f.client.dispose();
  for (const timer of late) timer.fire();
  await flush();
  assert.equal(f.reads.length, 1);
  assert.equal(f.timers.size, 0);
});

test('early timers rearm and late delivery triggers one read instead of a catch-up burst', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  handle.poll({ target: 'name', everyMs: 20 });
  [...f.timers][0].fire();
  await flush();
  assert.equal(f.reads.length, 1);
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers][0].at, 20);
  f.jump(1000);
  [...f.timers][0].fire();
  await flush();
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve([row({ name: 'late' })]);
  await flush();
  assert.equal([...f.timers][0].at, 1020);
});

test('clock and wait failures stop the affected group and surface an observable handle error', async (t) => {
  const time = clock();
  let broken = false;
  const f = setup(t, {
    pollingScheduler: {
      now() {
        if (broken) throw new Error('poll clock failed');
        return time.scheduler.now();
      },
      wait: time.scheduler.wait,
    },
  });
  const handle = await seed(f);
  handle.poll({ target: 'name', everyMs: 20 });
  broken = true;
  await time.advance(20);
  assert.equal(handle.getSnapshot().error, 'poll clock failed');
  assert.equal(f.reads.length, 1);
  assert.equal(time.timers.size, 0);
  broken = false;
  handle.poll({ target: 'name', everyMs: 20 });
  [...time.timers][0].fail(new Error('poll wait failed'));
  await flush();
  assert.equal(handle.getSnapshot().error, 'poll wait failed');
  assert.equal(time.timers.size, 0);
  await time.advance(1000);
  assert.equal(f.reads.length, 1);
});

test('polling scheduler methods are captured, with freshness scheduling as the portable fallback', async (t) => {
  const time = clock();
  const scheduling = { ...time.scheduler };
  const f = setup(t, {
    pollingScheduler: undefined,
    freshnessScheduler: scheduling,
  });
  scheduling.now = () => {
    throw new Error('mutated now');
  };
  scheduling.wait = () => {
    throw new Error('mutated wait');
  };
  const handle = await seed(f);
  handle.poll({ target: 'name', everyMs: 20 });
  await time.advance(20);
  assert.equal(f.reads.length, 2);
});

test('global, group and resource polling defaults are captured per owner and may differ within shared state', async (t) => {
  const requestPolicy = { polling: { everyMs: 100 } };
  const resourceGroups = {
    fast: { requestPolicy: { polling: { everyMs: 30 } } },
  };
  const f = setup(t, { requestPolicy, resourceGroups });
  requestPolicy.polling.everyMs = 999;
  resourceGroups.fast.requestPolicy.polling.everyMs = 999;
  const a = await seed(f);
  const overrides = {
    group: 'fast',
    requestPolicy: { polling: { everyMs: false } },
  };
  const b = f.client.watch(f.source, overrides);
  const c = f.client.watch(f.source, { group: 'fast' });
  await Promise.all([b.ready, c.ready]);
  overrides.requestPolicy.polling.everyMs = 1;
  a.poll({ target: 'name' });
  b.poll({ target: 'amount' });
  const stop = c.poll({ target: 'name' });
  await f.advance(30);
  assert.equal(f.reads.length, 2);
  assert.deepEqual(names(f.reads[1]), ['name']);
  f.reads[1].resolve([row({ name: 'group' })]);
  await flush();
  stop();
  await f.advance(100);
  assert.equal(f.reads.length, 3);
  assert.deepEqual(names(f.reads[2]), ['name']);
});

test('invalid polling policy and call durations reject without scheduling reads', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  for (const everyMs of [
    0,
    -1,
    0.5,
    NaN,
    Infinity,
    '20',
    null,
    true,
    2147483648,
  ]) {
    assert.throws(
      () => new AcquisitionClient({ requestPolicy: { polling: { everyMs } } }),
      /everyMs/,
    );
    assert.throws(() => handle.poll({ everyMs }), /everyMs/);
  }
  assert.throws(
    () => handle.poll({ target: 'missing', everyMs: 20 }),
    /Unknown selected field/,
  );
  assert.throws(() => handle.poll({ target: '', everyMs: 20 }), /empty/);
  for (const options of [null, [], { interval: 20 }])
    assert.throws(() => handle.poll(options), /Polling options/);
  for (const polling of [null, false, [], { interval: 20 }])
    assert.throws(
      () => new AcquisitionClient({ requestPolicy: { polling } }),
      /Polling policy/,
    );
  assert.equal(f.timers.size, 0);
  assert.equal(f.reads.length, 1);
  const client = new AcquisitionClient();
  t.after(() => client.dispose());
  const other = client.watch({
    ...f.source,
    read: async () => [row({ name: 'one', amount: 1 })],
  });
  await other.ready;
  const stop = other.poll();
  stop();
  assert.throws(() => other.poll({ everyMs: 20 }), /scheduler/i);
});

test('reentrant scheduler disposal during registration cannot retain or start an interest', async (t) => {
  for (const phase of ['now', 'wait']) {
    const time = clock();
    let dispose;
    const f = setup(t, {
      pollingScheduler: {
        now() {
          if (phase === 'now') dispose?.();
          return time.scheduler.now();
        },
        wait(ms, signal) {
          const pending = time.scheduler.wait(ms, signal);
          if (phase === 'wait') dispose?.();
          return pending;
        },
      },
    });
    const handle = await seed(f);
    dispose = () => handle.dispose();
    if (phase === 'now')
      assert.throws(() => handle.poll({ everyMs: 20 }), /disposed/);
    else handle.poll({ everyMs: 20 });
    assert.equal(time.timers.size, 0);
    await time.advance(100);
    assert.equal(f.reads.length, 1);
  }
});

test('polling patches list values without replacing order or admitting new members', async (t) => {
  const f = setup(t, {}, { collection: true });
  const handle = await seed(f, [
    row({ name: 'one', amount: 10 }),
    row({ name: 'two', amount: 20 }, '2'),
  ]);
  handle.poll({ target: 'name', everyMs: 20 });
  await f.advance(20);
  f.reads[1].resolve([
    row({ name: 'two-v2' }, '2'),
    row({ name: 'one-v2' }),
    row({ name: 'new' }, '3'),
  ]);
  await flush();
  assert.deepEqual(
    handle.getSnapshot().records.map((item) => item.identity.id),
    ['1', '2'],
  );
  assert.deepEqual(
    handle.getSnapshot().records.map((item) => item.data.name),
    ['one-v2', 'two-v2'],
  );
  assert.equal(handle.getSnapshot().membershipStale, true);
  assert.equal(handle.getSnapshot().records[0].data.amount, 10);
});

test('null and empty collections retain refresh semantics during polling', async (t) => {
  const f = setup(t, {}, { collection: true });
  const empty = await seed(f, []);
  empty.poll({ target: 'name', everyMs: 20 });
  await f.advance(20);
  f.reads[1].resolve([row({ name: 'new' })]);
  await flush();
  assert.deepEqual(empty.getSnapshot().records, []);
  assert.equal(empty.getSnapshot().membershipStale, true);
  empty.dispose();
  const nullSource = { ...f.source, stateAddress: 'null' };
  const nullable = f.client.watch(nullSource);
  await flush();
  f.reads[2].resolve({ kind: 'null' });
  await nullable.ready;
  nullable.poll({ target: 'name', everyMs: 20 });
  await f.advance(20);
  f.reads[3].resolve([row({ name: 'recovered' })]);
  await flush();
  assert.equal(nullable.getSnapshot().records[0].data.name, 'recovered');
  assert.equal(nullable.getSnapshot().records[0].data.amount, undefined);
});

test('a listener can stop and dispose a poll during its request notification without resurrecting timers', async (t) => {
  const f = setup(t);
  const handle = await seed(f);
  const stop = handle.poll({ target: 'name', everyMs: 20 });
  handle.subscribe(() => {
    if (handle.getSnapshot().fetching) {
      stop();
      handle.dispose();
    }
  });
  await f.advance(20);
  assert.equal(f.timers.size, 0);
  for (const read of f.reads.slice(1)) {
    assert.equal(read.signal.aborted, true);
    read.resolve([row({ name: 'late' })]);
  }
  const count = f.reads.length;
  await flush();
  await f.advance(1000);
  assert.equal(f.reads.length, count);
});

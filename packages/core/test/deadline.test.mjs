import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AcquisitionClient,
  AcquisitionCancelledError,
  AcquisitionSupersededError,
  ReadTimeoutError,
  ReadTransportError,
} from '../dist/index.js';

const fields = ['name', 'amount'].map((name) => ({
  name,
  responseName: name,
  arguments: {},
  children: [],
}));
const rows = (values) => [
  {
    identity: { id: '1' },
    fields: Object.entries(values).map(([name, value]) => ({
      kind: 'write',
      path: [{ name, arguments: {} }],
      value,
    })),
  },
];
async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
function clock() {
  let now = 0;
  const timers = new Set();
  const all = [];
  const scheduler = {
    random: () => 0.5,
    wait(ms, signal) {
      return new Promise((resolve, reject) => {
        const timer = {
          at: now + ms,
          ms,
          signal,
          fire: () => {
            unsubscribe();
            timers.delete(timer);
            resolve();
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
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers]
          .filter((timer) => timer.at <= end)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at;
        next.fire();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}
function setup(t, options = {}) {
  const time = clock();
  const client = new AcquisitionClient({
    requestPolicy: { requestTimeoutMs: 100 },
    scheduler: time.scheduler,
    ...options,
  });
  t.after(() => client.dispose());
  const reads = [];
  const source = {
    stateAddress: 'one',
    selection: fields,
    read: (selection, { signal }) =>
      new Promise((resolve, reject) =>
        reads.push({ selection, signal, resolve, reject }),
      ),
  };
  return { client, source, reads, ...time };
}
async function seed(f, data = rows({ name: 'old', amount: 10 })) {
  const handle = f.client.watch(f.source);
  await flush();
  f.reads[0].resolve(data);
  await handle.ready;
  return handle;
}

test('one deadline is shared; a late owner inherits remaining budget, and late success cannot commit', async (t) => {
  const f = setup(t);
  const a = f.client.watch(f.source);
  await flush();
  await f.advance(60);
  const b = f.client.watch(f.source);
  await flush();
  const aFailed = assert.rejects(a.ready, ReadTimeoutError),
    bFailed = assert.rejects(b.ready, ReadTimeoutError);
  assert.equal(f.reads.length, 1);
  assert.equal(f.timers.size, 1);
  await f.advance(39);
  assert.equal(a.getSnapshot().fetching, true);
  await f.advance(1);
  await Promise.all([aFailed, bFailed]);
  assert.equal(f.reads[0].signal.aborted, true);
  assert.equal(f.timers.size, 0);
  assert.equal(a.getSnapshot().fetching, false);
  f.reads[0].resolve(rows({ name: 'late', amount: 1 }));
  await flush();
  assert.equal(b.getSnapshot().records, undefined);
});

test('deadline includes retry backoff and never restarts a timed-out chain', async (t) => {
  const f = setup(t, { retry: { retries: 3, initialDelayMs: 200 } });
  const a = f.client.watch(f.source);
  await flush();
  const failed = assert.rejects(
    a.ready,
    (error) =>
      error instanceof ReadTimeoutError &&
      !error.retryable &&
      error.timeoutMs === 100,
  );
  await f.advance(50);
  f.reads[0].reject(new ReadTransportError('offline', { retryable: true }));
  await flush();
  assert.equal(f.timers.size, 2);
  await f.advance(50);
  await failed;
  assert.equal(f.timers.size, 0);
  await f.advance(1000);
  assert.equal(f.reads.length, 1);
});

test('retried transport attempt receives only the original deadline remainder', async (t) => {
  const f = setup(t, { retry: { retries: 1, initialDelayMs: 20 } });
  const a = f.client.watch(f.source);
  await flush();
  const failed = assert.rejects(a.ready, ReadTimeoutError);
  await f.advance(60);
  f.reads[0].reject(new ReadTransportError('offline', { retryable: true }));
  await flush();
  await f.advance(10);
  assert.equal(f.reads.length, 2);
  await f.advance(30);
  await failed;
  assert.equal(f.reads[1].signal.aborted, true);
});

test('timed-out refresh preserves data, shares eligible field errors and permits explicit recovery', async (t) => {
  const f = setup(t);
  const a = await seed(f);
  const b = f.client.watch(f.source);
  await b.ready;
  const failed = assert.rejects(a.refresh('name'), ReadTimeoutError);
  await flush();
  await f.advance(100);
  await failed;
  const snapshot = b.getSnapshot();
  assert.deepEqual(
    { ...snapshot.records[0].data },
    { name: 'old', amount: 10 },
  );
  assert.equal(
    snapshot.records[0].fields.find((field) => field.path[0] === 'name').stale,
    true,
  );
  assert.match(
    snapshot.records[0].fields.find((field) => field.path[0] === 'name').error,
    /deadline/,
  );
  assert.equal(
    snapshot.records[0].fields.find((field) => field.path[0] === 'amount')
      .error,
    undefined,
  );
  const recovered = a.ensure();
  await flush();
  assert.deepEqual(
    f.reads[2].selection.map((field) => field.name),
    ['name'],
  );
  f.reads[2].resolve(rows({ name: 'new' }));
  await recovered;
  f.reads[1].reject(new Error('late rejection'));
  await flush();
  assert.equal(b.getSnapshot().records[0].data.name, 'new');
  assert.equal(f.timers.size, 0);
});

test('timeout does not invent records for unknown, null or empty resources', async (t) => {
  for (const data of [undefined, { kind: 'null' }, []]) {
    const f = setup(t);
    const a =
      data === undefined ? f.client.watch(f.source) : await seed(f, data);
    const failed = assert.rejects(
      data === undefined ? a.ready : a.refresh(),
      ReadTimeoutError,
    );
    await flush();
    await f.advance(100);
    await failed;
    assert.deepEqual(
      a.getSnapshot().records,
      data?.kind === 'null' ? null : data,
    );
    assert.equal(a.getSnapshot().fetching, false);
  }
});

test('one owner disposing preserves work; final owner or client disposal releases deadline and transport', async (t) => {
  for (const disposeClient of [false, true]) {
    const f = setup(t);
    const a = f.client.watch(f.source),
      b = f.client.watch(f.source);
    await flush();
    const af = assert.rejects(a.ready, AcquisitionCancelledError),
      bf = assert.rejects(b.ready, AcquisitionCancelledError);
    a.dispose();
    await af;
    assert.equal(f.timers.size, 1);
    assert.equal(f.reads[0].signal.aborted, false);
    if (disposeClient) f.client.dispose();
    else b.dispose();
    await bf;
    assert.equal(f.timers.size, 0);
    assert.equal(f.reads[0].signal.aborted, true);
    await f.advance(1000);
    assert.equal(f.reads.length, 1);
  }
});

test('successful and failed reads release timers; old callbacks cannot affect later work', async (t) => {
  const f = setup(t);
  const a = await seed(f);
  const old = f.all[0];
  assert.equal(old.signal.aborted, true);
  assert.equal(f.timers.size, 0);
  const failed = assert.rejects(a.refresh(), /decode/);
  await flush();
  f.reads[1].reject(new Error('decode'));
  await failed;
  assert.equal(f.timers.size, 0);
  const next = a.refresh();
  await flush();
  old.fire();
  await flush();
  assert.equal(f.reads[2].signal.aborted, false);
  f.reads[2].resolve(rows({ name: 'new', amount: 20 }));
  await next;
  assert.equal(f.timers.size, 0);
});

test('deadline scheduling failure terminates the request and does not retry', async (t) => {
  for (const synchronous of [false, true]) {
    const f = setup(t, {
      deadlineScheduler: {
        wait() {
          if (synchronous) throw new Error('clock broke');
          return Promise.reject(new Error('clock broke'));
        },
      },
    });
    const a = f.client.watch(f.source);
    await assert.rejects(a.ready, /deadline scheduler failed/);
    if (f.reads.length) assert.equal(f.reads[0].signal.aborted, true);
    assert.equal(a.getSnapshot().fetching, false);
  }
});

test('uncooperative deadline scheduler cannot prevent cancellation or reject settled work later', async (t) => {
  const waits = [];
  const f = setup(t, {
    deadlineScheduler: {
      wait: (ms, signal) =>
        new Promise((resolve, reject) =>
          waits.push({ ms, signal, resolve, reject }),
        ),
    },
  });
  const a = await seed(f);
  assert.equal(waits[0].signal.aborted, true);
  const failed = assert.rejects(a.refresh(), AcquisitionCancelledError);
  await flush();
  a.dispose();
  await failed;
  assert.equal(waits[1].signal.aborted, true);
  waits[0].resolve();
  waits[1].reject(new Error('late clock'));
  await flush();
});

test('an older timeout only marks still-eligible fields and cannot roll back newer values', async (t) => {
  const f = setup(t);
  const a = await seed(f);
  const old = assert.rejects(a.refresh(), AcquisitionSupersededError);
  await flush();
  await f.advance(10);
  const narrow = a.refresh('name');
  await flush();
  f.reads[2].resolve(rows({ name: 'new' }));
  await narrow;
  await f.advance(90);
  await old;
  const snapshot = a.getSnapshot();
  assert.equal(snapshot.records[0].data.name, 'new');
  assert.equal(
    snapshot.records[0].fields.find((field) => field.path[0] === 'name').error,
    undefined,
  );
  assert.match(
    snapshot.records[0].fields.find((field) => field.path[0] === 'amount')
      .error,
    /deadline/,
  );
  f.reads[1].resolve(rows({ name: 'late', amount: 99 }));
  await flush();
  assert.equal(a.getSnapshot().records[0].data.amount, 10);
});

test('disjoint requests have independent deadlines and cleanup', async (t) => {
  const f = setup(t);
  const a = await seed(f);
  const failed = assert.rejects(a.refresh('name'), ReadTimeoutError);
  await flush();
  await f.advance(50);
  const amount = a.refresh('amount');
  await flush();
  await f.advance(50);
  await failed;
  assert.equal(f.reads[2].signal.aborted, false);
  assert.equal(f.timers.size, 1);
  f.reads[2].resolve(rows({ amount: 20 }));
  await amount;
  assert.equal(f.timers.size, 0);
});

test('global, group and resource overrides inherit; false disables without changing identity', async (t) => {
  const f = setup(t, {
    requestPolicyGroups: {
      fast: { requestTimeoutMs: 20 },
      same: { requestTimeoutMs: 100 },
      inherited: {},
    },
  });
  const a = f.client.watch(f.source),
    b = f.client.watch(f.source, { group: 'same' }),
    c = f.client.watch(f.source, { group: 'inherited' });
  await flush();
  assert.equal(f.reads.length, 1);
  f.reads[0].resolve(rows({ name: 'ok', amount: 1 }));
  await Promise.all([a.ready, b.ready, c.ready]);
  assert.equal(a.stateAddress, b.stateAddress);
  const fast = f.client.watch(
    { ...f.source, stateAddress: 'two' },
    { group: 'fast' },
  );
  const failed = assert.rejects(fast.ready, ReadTimeoutError);
  await flush();
  await f.advance(20);
  await failed;
  const disabled = f.client.watch(
    { ...f.source, stateAddress: 'three' },
    { group: 'fast', requestPolicy: { requestTimeoutMs: false } },
  );
  await flush();
  assert.equal(f.timers.size, 0);
  await f.advance(1000);
  f.reads.at(-1).resolve(rows({ name: 'ok', amount: 1 }));
  await disabled.ready;
});

test('caller mutation cannot change captured defaults, groups, resource policies or clock methods', async (t) => {
  const policy = { requestTimeoutMs: 30 },
    group = { requestTimeoutMs: 40 };
  const time = clock();
  const scheduler = { wait: time.scheduler.wait };
  const f = setup(t, {
    requestPolicy: policy,
    requestPolicyGroups: { group },
    deadlineScheduler: scheduler,
  });
  policy.requestTimeoutMs = 1;
  group.requestTimeoutMs = 2;
  scheduler.wait = () => {
    throw new Error('changed');
  };
  const binding = { requestTimeoutMs: 50 };
  const a = f.client.watch(f.source, { requestPolicy: binding });
  binding.requestTimeoutMs = 3;
  const b = f.client.watch(
    { ...f.source, stateAddress: 'two' },
    { group: 'group' },
  );
  const c = f.client.watch({ ...f.source, stateAddress: 'three' });
  const failures = [a, b, c].map((handle) =>
    assert.rejects(handle.ready, ReadTimeoutError),
  );
  await flush();
  assert.deepEqual(
    time.all.map((timer) => timer.ms),
    [50, 40, 30],
  );
  await time.advance(50);
  await Promise.all(failures);
});

test('conflicting and unknown bindings fail without joining work; inactive scopes keep their binding', async (t) => {
  const f = setup(t);
  const a = f.client.watch(f.source);
  await flush();
  assert.throws(
    () => f.client.watch(f.source, { group: 'missing' }),
    /Unknown request policy group/,
  );
  assert.throws(
    () =>
      f.client.watch(f.source, { requestPolicy: { requestTimeoutMs: false } }),
    /same effective/,
  );
  assert.equal(f.reads.length, 1);
  assert.equal(f.timers.size, 1);
  const failed = assert.rejects(a.ready, AcquisitionCancelledError);
  a.dispose();
  await failed;
  assert.equal(f.reads[0].signal.aborted, true);
  assert.equal(f.timers.size, 0);
  assert.throws(
    () =>
      f.client.watch(f.source, { requestPolicy: { requestTimeoutMs: 200 } }),
    /same effective/,
  );
});

test('disabled defaults need no timer; invalid policies fail before I/O and enabled core requires a clock', async (t) => {
  const f = setup(t, { requestPolicy: {} });
  const a = f.client.watch(f.source);
  await flush();
  assert.equal(f.timers.size, 0);
  f.reads[0].resolve(rows({ name: 'ok', amount: 1 }));
  await a.ready;
  for (const value of [
    0,
    -1,
    1.5,
    Infinity,
    NaN,
    2_147_483_648,
    true,
    null,
    '100',
  ]) {
    assert.throws(
      () =>
        new AcquisitionClient({ requestPolicy: { requestTimeoutMs: value } }),
      /requestTimeoutMs/,
    );
    assert.throws(
      () =>
        f.client.watch(f.source, {
          requestPolicy: { requestTimeoutMs: value },
        }),
      /requestTimeoutMs/,
    );
  }
  assert.throws(
    () => new AcquisitionClient({ requestPolicy: { staleTimeMs: 10 } }),
    /only requestTimeoutMs/,
  );
  const portable = new AcquisitionClient({
    requestPolicy: { requestTimeoutMs: 10 },
  });
  t.after(() => portable.dispose());
  assert.throws(() => portable.watch(f.source), /DelayScheduler/);
  assert.equal(f.reads.length, 1);
});

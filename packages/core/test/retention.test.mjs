import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AcquisitionClient,
  AcquisitionCancelledError,
  ReadTransportError,
} from '../dist/index.js';

const selection = ['name', 'amount'].map((name) => ({
  name,
  responseName: name,
  arguments: {},
  children: [],
}));
const rows = (name = 'old') => [
  {
    identity: { id: '1' },
    fields: [
      { kind: 'write', path: [{ name: 'name', arguments: {} }], value: name },
      { kind: 'write', path: [{ name: 'amount', arguments: {} }], value: 1 },
    ],
  },
];
const flush = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};
function clock() {
  let now = 0;
  const timers = new Set(),
    all = [];
  const fault = { now: undefined, wait: undefined, onAbort: undefined };
  const scheduler = {
    now: () => {
      fault.onNow?.();
      if (fault.now) throw fault.now;
      return now;
    },
    random: () => 0.5,
    wait(ms, signal) {
      if (fault.wait) throw fault.wait;
      return new Promise((resolve, reject) => {
        const timer = {
          at: now + ms,
          ms,
          signal,
          fire: () => {
            off();
            timers.delete(timer);
            resolve();
          },
          reject,
        };
        const off = signal.subscribe(() => {
          timers.delete(timer);
          reject(signal.reason);
          fault.onAbort?.();
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
    fault,
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
        now = next.at;
        next.fire();
        await flush();
      }
      throw Error('Timer loop');
    },
  };
}
function setup(
  t,
  { retentionMs = 100, options = {}, collection = false } = {},
) {
  const time = clock(),
    errors = [],
    reads = [];
  const client = new AcquisitionClient({
    retentionScheduler: time.scheduler,
    requestPolicy: { retentionMs },
    onRetentionError: (error, address) => errors.push({ error, address }),
    ...options,
  });
  t.after(() => client.dispose());
  const source = {
    stateAddress: 'one',
    selection,
    collection,
    read(fields, { signal }) {
      return new Promise((resolve, reject) =>
        reads.push({ fields, signal, resolve, reject }),
      );
    },
  };
  return { client, source, errors, reads, ...time };
}
async function seed(f, data = rows()) {
  const a = f.client.watch(f.source);
  await flush();
  f.reads.at(-1).resolve(data);
  await a.ready;
  return a;
}

test('positive retention starts at final departure, reuses cached values before expiry, and resets on the next departure', async (t) => {
  const f = setup(t),
    a = await seed(f),
    b = f.client.watch(f.source);
  await b.ready;
  assert.equal(f.timers.size, 0);
  a.dispose();
  await f.advance(500);
  assert.equal(f.timers.size, 0);
  assert.equal(b.getSnapshot().stale, false);
  b.dispose();
  assert.equal(f.timers.size, 1);
  await f.advance(90);
  const c = f.client.watch(f.source);
  await c.ready;
  assert.equal(f.reads.length, 1);
  assert.equal(f.timers.size, 0);
  await f.advance(500);
  assert.equal(c.getSnapshot().records[0].data.name, 'old');
  c.dispose();
  await f.advance(99);
  assert.equal(f.timers.size, 1);
  await f.advance(1);
  const d = f.client.watch(f.source);
  assert.equal(d.getSnapshot().records, undefined);
  await flush();
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve(rows('new'));
  await d.ready;
});
test('zero evicts synchronously without a clock; disabled retention reuses indefinitely', async (t) => {
  for (const retentionMs of [0, false]) {
    const f = setup(t, {
        retentionMs,
        options: { retentionScheduler: undefined },
      }),
      a = await seed(f);
    const snapshot = a.getSnapshot();
    a.dispose();
    const b = f.client.watch(f.source);
    assert.equal(b.getSnapshot().records === undefined, retentionMs === 0);
    await flush();
    if (retentionMs === 0) f.reads[1].resolve(rows('new'));
    await b.ready;
    assert.equal(a.getSnapshot(), snapshot);
    assert.equal(f.reads.length, retentionMs === 0 ? 2 : 1);
  }
});
test('repeated dispose cannot extend the deadline or affect a replacement scope', async (t) => {
  const f = setup(t),
    a = await seed(f);
  a.dispose();
  await f.advance(75);
  a.dispose();
  assert.equal(f.all.length, 1);
  await f.advance(25);
  const b = f.client.watch(f.source);
  await flush();
  a.dispose();
  assert.equal(f.reads[1].signal.aborted, false);
  f.reads[1].resolve(rows('new'));
  await b.ready;
  assert.equal(f.timers.size, 0);
});
test('overdue demand evicts before policy conflicts, even if no timer callback has run', async (t) => {
  const f = setup(t),
    a = await seed(f);
  a.dispose();
  const late = [...f.timers][0];
  f.jump(100);
  const b = f.client.watch(f.source, {
    requestPolicy: { retentionMs: 0, freshness: { staleTimeMs: false } },
  });
  assert.equal(b.getSnapshot().records, undefined);
  await flush();
  late.fire();
  await flush();
  assert.equal(f.reads[1].signal.aborted, false);
  f.reads[1].resolve(rows('new'));
  await b.ready;
  late.fire();
  await flush();
  assert.equal(b.getSnapshot().records[0].data.name, 'new');
});
test('a rejected watch leaves the original inactive deadline intact', async (t) => {
  const f = setup(t),
    a = await seed(f);
  a.dispose();
  const timer = [...f.timers][0];
  await f.advance(50);
  assert.throws(
    () => f.client.watch(f.source, { requestPolicy: { retentionMs: 200 } }),
    /same effective retentionMs/,
  );
  assert.throws(
    () => f.client.watch({ ...f.source, selection: [] }),
    /Selection/,
  );
  assert.throws(() => f.client.watch({ ...f.source, read: undefined }), /bind/);
  assert.equal(timer.signal.aborted, false);
  assert.equal(f.all.length, 1);
  await f.advance(50);
  const b = f.client.watch(f.source, { requestPolicy: { retentionMs: 0 } });
  await flush();
  f.reads[1].resolve(rows());
  await b.ready;
});
test('cancelled retention callbacks cannot evict a reacquired active scope', async (t) => {
  const f = setup(t),
    a = await seed(f);
  a.dispose();
  const late = [...f.timers][0];
  await f.advance(50);
  const b = f.client.watch(f.source);
  await b.ready;
  assert.equal(late.signal.aborted, true);
  f.jump(100);
  late.fire();
  await flush();
  const c = f.client.watch(f.source);
  await c.ready;
  assert.equal(f.reads.length, 1);
  assert.equal(b.getSnapshot().records[0].data.name, 'old');
});
test('eviction removes data, field errors, membership and policy binding for null, empty and partial resources', async (t) => {
  for (const data of [
    { kind: 'null' },
    [],
    [
      {
        identity: { id: '1' },
        fields: [
          {
            kind: 'error',
            path: [{ name: 'name', arguments: {} }],
            message: 'bad',
          },
          {
            kind: 'write',
            path: [{ name: 'amount', arguments: {} }],
            value: 2,
          },
        ],
      },
    ],
  ]) {
    const f = setup(t, { retentionMs: 0, collection: true }),
      a = f.client.watch(f.source);
    await flush();
    f.reads[0].resolve(data);
    await a.ready.catch(() => {});
    const snapshot = a.getSnapshot();
    a.dispose();
    const b = f.client.watch(f.source, {
      requestPolicy: { retentionMs: false },
    });
    assert.equal(b.getSnapshot().records, undefined);
    assert.equal(b.getSnapshot().error, undefined);
    await flush();
    f.reads[1].resolve(rows('recovered'));
    await b.ready;
    assert.equal(b.getSnapshot().stale, false);
    assert.equal(a.getSnapshot(), snapshot);
  }
});
test('late source success and failure cannot resurrect an evicted scope or clear new fetching state', async (t) => {
  for (const lateResult of ['success', 'failure']) {
    const f = setup(t, { retentionMs: 0 }),
      a = f.client.watch(f.source);
    const rejected = assert.rejects(a.ready, AcquisitionCancelledError);
    await flush();
    a.dispose();
    await rejected;
    const b = f.client.watch(f.source);
    await flush();
    assert.equal(b.getSnapshot().fetching, true);
    if (lateResult === 'success') f.reads[0].resolve(rows('late'));
    else f.reads[0].reject(Error('late failure'));
    await flush();
    assert.equal(b.getSnapshot().records, undefined);
    assert.equal(b.getSnapshot().fetching, true);
    f.reads[1].resolve(rows('current'));
    await b.ready;
    assert.equal(b.getSnapshot().records[0].data.name, 'current');
  }
});
test('final departure cancels retry/deadline work before retention and old work cannot return after eviction', async (t) => {
  const time = clock();
  const f = setup(t, {
    options: {
      scheduler: time.scheduler,
      deadlineScheduler: time.scheduler,
      retentionScheduler: time.scheduler,
      retry: { retries: 2, initialDelayMs: 1000 },
      requestPolicy: { retentionMs: 100, requestTimeoutMs: 500 },
    },
  });
  const a = f.client.watch(f.source);
  const rejected = assert.rejects(a.ready, AcquisitionCancelledError);
  await flush();
  f.reads[0].reject(new ReadTransportError('retry', { retryable: true }));
  await flush();
  assert.equal(time.timers.size, 2);
  a.dispose();
  await rejected;
  assert.equal(time.timers.size, 1);
  assert.equal([...time.timers][0].ms, 100);
  await time.advance(1000);
  assert.equal(f.reads.length, 1);
  assert.equal(time.timers.size, 0);
});
test('freshness age is preserved across retained reuse and all freshness metadata is removed by eviction', async (t) => {
  const time = clock();
  const f = setup(t, {
    options: {
      freshnessScheduler: time.scheduler,
      retentionScheduler: undefined,
      requestPolicy: { retentionMs: 200, freshness: { staleTimeMs: 100 } },
    },
  });
  const a = await seed(f);
  await time.advance(40);
  a.dispose();
  assert.equal(time.timers.size, 1);
  await time.advance(40);
  const b = f.client.watch(f.source);
  await b.ready;
  assert.equal(f.reads.length, 1);
  await time.advance(20);
  assert.equal(b.getSnapshot().stale, true);
  b.dispose();
  await time.advance(200);
  const c = f.client.watch(f.source);
  await flush();
  f.reads[1].resolve(rows('new'));
  await c.ready;
  assert.equal(c.getSnapshot().stale, false);
  await time.advance(99);
  assert.equal(c.getSnapshot().stale, false);
});
test('independent scoped addresses evict separately without touching active data', async (t) => {
  const f = setup(t),
    a = await seed(f);
  const other = { ...f.source, stateAddress: 'tenant-b/schema-2' };
  const b = f.client.watch(other);
  await flush();
  f.reads[1].resolve(rows('other'));
  await b.ready;
  a.dispose();
  await f.advance(100);
  assert.equal(b.getSnapshot().records[0].data.name, 'other');
  assert.equal(b.getSnapshot().stale, false);
  const c = f.client.watch(f.source);
  assert.equal(c.getSnapshot().records, undefined);
  await flush();
  f.reads[2].resolve(rows('new'));
  await c.ready;
  assert.equal(b.getSnapshot().records[0].data.name, 'other');
});
test('clock and wait failures evict inactive state and isolate throwing diagnostics', async (t) => {
  for (const failure of ['now', 'wait', 'reject']) {
    const f = setup(t),
      a = await seed(f);
    if (failure === 'now') f.fault.now = Error('clock failed');
    if (failure === 'wait') f.fault.wait = Error('wait failed');
    a.dispose();
    if (failure === 'reject') {
      [...f.timers][0].reject(Error('wait rejected'));
      await flush();
    }
    assert.equal(f.errors.length, 1);
    assert.equal(f.errors[0].address, 'one');
    assert.equal(f.timers.size, 0);
    f.fault.now = undefined;
    f.fault.wait = undefined;
    const b = f.client.watch(f.source, { requestPolicy: { retentionMs: 0 } });
    assert.equal(b.getSnapshot().records, undefined);
    await flush();
    f.reads[1].resolve(rows());
    await b.ready;
  }
  const f = setup(t, {
      options: {
        onRetentionError: () => {
          throw Error('diagnostic failed');
        },
      },
    }),
    a = await seed(f);
  f.fault.wait = Error('wait failed');
  assert.doesNotThrow(() => a.dispose());
});
test('clock failure on demand allows safe rebinding and diagnostics see a fully evicted cache', async (t) => {
  let reentered;
  const time = clock();
  const f = setup(t, {
    options: {
      retentionScheduler: time.scheduler,
      onRetentionError: () => {
        reentered = f.client.watch(f.source, {
          requestPolicy: { retentionMs: 0 },
        });
      },
    },
  });
  const a = await seed(f);
  a.dispose();
  time.fault.now = Error('clock failed');
  const b = f.client.watch(f.source, { requestPolicy: { retentionMs: 0 } });
  await flush();
  assert.equal(b.getSnapshot().records, undefined);
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve(rows('new'));
  await Promise.all([b.ready, reentered.ready]);
  assert.equal(b.getSnapshot().records[0].data.name, 'new');
});
test('reentrant timer cancellation at eviction cannot attach to the old scope', async (t) => {
  const f = setup(t),
    a = await seed(f);
  a.dispose();
  let replacement;
  f.fault.onAbort = () => {
    f.fault.onAbort = undefined;
    replacement = f.client.watch(f.source, {
      requestPolicy: { retentionMs: 0 },
    });
  };
  f.jump(100);
  const b = f.client.watch(f.source, { requestPolicy: { retentionMs: 0 } });
  await flush();
  assert.equal(f.reads.length, 2);
  assert.equal(b.getSnapshot().records, undefined);
  f.reads[1].resolve(rows('new'));
  await Promise.all([b.ready, replacement.ready]);
  assert.equal(b.getSnapshot().records[0].data.name, 'new');
});
test('source cancellation may attach a new owner without scheduling inactive retention', async (t) => {
  const f = setup(t, { retentionMs: 0 });
  let replacement;
  const source = {
    ...f.source,
    read(fields, context) {
      context.signal.subscribe(() => {
        if (!replacement) replacement = f.client.watch(f.source);
      });
      return f.source.read(fields, context);
    },
  };
  const a = f.client.watch(source);
  const rejected = assert.rejects(a.ready, AcquisitionCancelledError);
  await flush();
  a.dispose();
  await rejected;
  await flush();
  assert.equal(f.reads.length, 2);
  assert.equal(f.reads[1].signal.aborted, false);
  f.reads[1].resolve(rows('new'));
  await replacement.ready;
  assert.equal(replacement.getSnapshot().records[0].data.name, 'new');
});
test('early timer delivery waits for elapsed time; client disposal cancels inactive timers without diagnostics', async (t) => {
  const f = setup(t),
    a = await seed(f);
  a.dispose();
  const early = [...f.timers][0];
  f.jump(50);
  early.fire();
  await flush();
  assert.equal([...f.timers][0].ms, 50);
  f.client.dispose();
  assert.equal(f.timers.size, 0);
  assert.equal(f.errors.length, 0);
  early.fire();
  await flush();
  assert.equal(f.errors.length, 0);
});
test('retention policy is captured, inherited and checked across every owner of the address', async (t) => {
  const time = clock(),
    policy = { retentionMs: 500 };
  const client = new AcquisitionClient({
    retentionScheduler: time.scheduler,
    requestPolicy: policy,
    requestPolicyGroups: {
      forms: { retentionMs: 100 },
      off: { retentionMs: false },
    },
  });
  t.after(() => client.dispose());
  policy.retentionMs = 1;
  const source = { stateAddress: 'one', selection, read: async () => rows() };
  const a = client.watch(source, { group: 'forms' });
  await a.ready;
  const b = client.watch(source, { requestPolicy: { retentionMs: 100 } });
  await b.ready;
  assert.throws(
    () => client.watch(source, { group: 'off' }),
    /same effective retentionMs/,
  );
  a.dispose();
  b.dispose();
  assert.equal([...time.timers][0].ms, 100);
  const c = client.watch({ ...source, stateAddress: 'two' });
  await c.ready;
  c.dispose();
  assert.ok([...time.timers].some((timer) => timer.ms === 500));
});
test('invalid retention configuration and missing clocks fail before any source execution', async (t) => {
  let reads = 0;
  const source = {
    stateAddress: 'one',
    selection,
    read: async () => {
      reads++;
      return rows();
    },
  };
  for (const retentionMs of [-1, 0.5, NaN, Infinity, '100', null, 2147483648])
    assert.throws(
      () => new AcquisitionClient({ requestPolicy: { retentionMs } }),
      /retentionMs/,
    );
  const client = new AcquisitionClient({ requestPolicy: { retentionMs: 100 } });
  t.after(() => client.dispose());
  assert.throws(() => client.watch(source), /retentionScheduler/);
  assert.equal(reads, 0);
  const invalid = new AcquisitionClient({
    retentionScheduler: { now: () => NaN, wait: async () => {} },
    requestPolicy: { retentionMs: 100 },
  });
  t.after(() => invalid.dispose());
  assert.throws(() => invalid.watch(source), /finite/);
  assert.equal(reads, 0);
});

test('reentrant now during final departure cannot arm an active resource or disable later retention', async (t) => {
  for (const throwAfterReentry of [false, true]) {
    const f = setup(t),
      a = await seed(f);
    let replacement;
    f.fault.onNow = () => {
      f.fault.onNow = undefined;
      replacement = f.client.watch(f.source);
      if (throwAfterReentry) throw Error('obsolete clock failure');
    };
    a.dispose();
    await replacement.ready;
    assert.equal(f.timers.size, 0);
    assert.equal(f.errors.length, 0);
    await f.advance(100);
    replacement.dispose();
    assert.equal(f.timers.size, 1);
    await f.advance(100);
    const b = f.client.watch(f.source);
    assert.equal(b.getSnapshot().records, undefined);
    await flush();
    f.reads[1].resolve(rows('new'));
    await b.ready;
  }
});

test('reentrant now during timer setup or demand cannot leave a stale retention callback', async (t) => {
  for (const phase of ['setup', 'demand']) {
    const f = setup(t),
      a = await seed(f);
    let replacement,
      calls = 0;
    if (phase === 'setup')
      f.fault.onNow = () => {
        if (++calls === 2) {
          f.fault.onNow = undefined;
          replacement = f.client.watch(f.source);
        }
      };
    a.dispose();
    if (phase === 'demand') {
      f.jump(50);
      f.fault.onNow = () => {
        f.fault.onNow = undefined;
        replacement = f.client.watch(f.source);
      };
      const temporary = f.client.watch(f.source);
      await temporary.ready;
      temporary.dispose();
    }
    await replacement.ready;
    assert.equal(f.timers.size, 0);
    replacement.dispose();
    assert.equal(f.timers.size, 1);
    await f.advance(100);
    const b = f.client.watch(f.source);
    assert.equal(b.getSnapshot().records, undefined);
    await flush();
    f.reads[1].resolve(rows());
    await b.ready;
  }
});

test('same-address reentrant initialization rejects before creating orphan ownership and releases its guard', async (t) => {
  const f = setup(t);
  f.fault.onNow = () => {
    f.fault.onNow = undefined;
    f.client.watch(f.source);
  };
  assert.throws(
    () => f.client.watch(f.source),
    /initialization is already in progress/,
  );
  await flush();
  assert.equal(f.reads.length, 0);
  assert.equal(f.timers.size, 0);
  const a = await seed(f);
  const b = f.client.watch(f.source);
  await b.ready;
  assert.equal(f.reads.length, 1);
  a.dispose();
  assert.equal(f.timers.size, 0);
  b.dispose();
  assert.equal(f.timers.size, 1);
});

test('different-address reentrant initialization remains isolated and client-owned', async (t) => {
  const f = setup(t);
  let other;
  f.fault.onNow = () => {
    f.fault.onNow = undefined;
    other = f.client.watch({ ...f.source, stateAddress: 'other' });
  };
  const a = f.client.watch(f.source);
  await flush();
  assert.equal(f.reads.length, 2);
  f.reads.forEach((read) => read.resolve(rows()));
  await Promise.all([a.ready, other.ready]);
  a.dispose();
  other.dispose();
  assert.equal(f.timers.size, 2);
  f.client.dispose();
  assert.equal(f.timers.size, 0);
});

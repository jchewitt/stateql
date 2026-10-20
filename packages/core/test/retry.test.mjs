import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AcquisitionClient,
  AcquisitionCancelledError,
  AcquisitionSupersededError,
  ReadTransportError,
} from '../dist/index.js';

const field = (name) => ({
  name,
  responseName: name,
  arguments: {},
  children: [],
});
const fields = [field('name'), field('amount')];
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
const failure = (retryable = true, retryAfterMs) =>
  new ReadTransportError('offline', {
    retryable,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });
const track = (promise) => {
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
function setup(t, options = {}) {
  const reads = [],
    waits = [];
  const scheduler = {
    random: () => 0.5,
    // Deliberately ignores cancellation: the coordinator must still settle.
    wait: (ms, signal) =>
      new Promise((resolve, reject) =>
        waits.push({ ms, signal, resolve, reject }),
      ),
  };
  const client = new AcquisitionClient({ retry: {}, scheduler, ...options });
  t.after(() => client.dispose());
  const source = {
    stateAddress: 'one',
    selection: fields,
    read: (selection, { signal }) =>
      new Promise((resolve, reject) =>
        reads.push({ selection, signal, resolve, reject }),
      ),
  };
  return { client, source, reads, waits };
}
async function seed(f, data = rows({ name: 'old', amount: 10 })) {
  const handle = f.client.watch(f.source);
  await until(() => f.reads.length === 1);
  f.reads[0].resolve(data);
  await handle.ready;
  return handle;
}

test('shared read uses one capped exponential jitter budget and stays fetching through backoff', async (t) => {
  const f = setup(t, {
    retry: { retries: 3, initialDelayMs: 200, maxDelayMs: 400 },
  });
  const a = f.client.watch(f.source),
    b = f.client.watch(f.source);
  for (let attempt = 0; attempt < 3; attempt++) {
    await until(() => f.reads.length === attempt + 1);
    f.reads[attempt].reject(failure());
    await until(() => f.waits.length === attempt + 1);
    assert.equal(a.getSnapshot().fetching, true);
    assert.equal(a.getSnapshot().error, undefined);
    assert.equal(b.getSnapshot().fetching, true);
    f.waits[attempt].resolve();
  }
  await until(() => f.reads.length === 4);
  f.reads[3].resolve(rows({ name: 'recovered', amount: 20 }));
  await Promise.all([a.ready, b.ready]);
  assert.deepEqual(
    f.waits.map((wait) => wait.ms),
    [100, 200, 200],
  );
  assert.equal(a.getSnapshot().fetching, false);
  assert.equal(b.getSnapshot().records[0].data.name, 'recovered');
});

test('exhaustion retains cached values and shares errors only on requested fields; ensure recovers them', async (t) => {
  const f = setup(t, { retry: { retries: 1 } });
  const a = await seed(f),
    b = f.client.watch(f.source);
  await b.ready;
  const failed = assert.rejects(a.refresh('name'), ReadTransportError);
  await until(() => f.reads.length === 2);
  f.reads[1].reject(failure());
  await until(() => f.waits.length === 1);
  f.waits[0].resolve();
  await until(() => f.reads.length === 3);
  f.reads[2].reject(failure());
  await failed;
  assert.deepEqual(
    { ...a.getSnapshot().records[0].data },
    { name: 'old', amount: 10 },
  );
  assert.equal(
    b.getSnapshot().records[0].fields.find((f) => f.path[0] === 'name').error,
    'offline',
  );
  assert.equal(
    b.getSnapshot().records[0].fields.find((f) => f.path[0] === 'amount').stale,
    false,
  );
  assert.equal(b.getSnapshot().error, undefined);
  const ensured = a.ensure();
  await until(() => f.reads.length === 4);
  assert.deepEqual(
    f.reads[3].selection.map((f) => f.name),
    ['name'],
  );
  f.reads[3].resolve(rows({ name: 'new' }));
  await ensured;
  assert.equal(a.getSnapshot().stale, false);
});

test('unclassified errors and nonretryable transport failures do not schedule retries', async (t) => {
  for (const error of [new Error('decode failed'), failure(false)]) {
    const f = setup(t);
    const handle = await seed(f);
    const failed = assert.rejects(handle.refresh('name'), (e) => e === error);
    await until(() => f.reads.length === 2);
    f.reads[1].reject(error);
    await failed;
    assert.equal(f.waits.length, 0);
    assert.equal(
      handle.getSnapshot().stale,
      error instanceof ReadTransportError,
    );
  }
});

test('portable defaults and explicit false/zero disable automatic retries', async (t) => {
  for (const retry of [undefined, false, { retries: 0 }]) {
    const f = setup(t, { retry });
    const handle = f.client.watch(f.source);
    await until(() => f.reads.length === 1);
    f.reads[0].reject(failure());
    await assert.rejects(handle.ready, ReadTransportError);
    assert.equal(f.waits.length, 0);
    assert.equal(f.reads.length, 1);
  }
});

test('terminal failures do not invent records or turn unknown, null or empty resources into data', async (t) => {
  for (const data of [undefined, { kind: 'null' }, []]) {
    const f = setup(t, { retry: false });
    const handle =
      data === undefined ? f.client.watch(f.source) : await seed(f, data);
    const failed = data === undefined ? handle.ready : handle.refresh();
    const rejection = assert.rejects(failed, ReadTransportError);
    await until(() => f.reads.length === (data === undefined ? 1 : 2));
    f.reads.at(-1).reject(failure());
    await rejection;
    assert.deepEqual(
      handle.getSnapshot().records,
      data?.kind === 'null' ? null : data,
    );
    assert.equal(handle.getSnapshot().error, 'offline');
  }
});

test('one owner leaving preserves retry work, final-owner disposal cancels even an uncooperative scheduler', async (t) => {
  const f = setup(t);
  const a = f.client.watch(f.source),
    b = f.client.watch(f.source);
  await until(() => f.reads.length === 1);
  f.reads[0].reject(failure());
  await until(() => f.waits.length === 1);
  a.dispose();
  await assert.rejects(a.ready, AcquisitionCancelledError);
  assert.equal(f.waits[0].signal.aborted, false);
  b.dispose();
  await assert.rejects(b.ready, AcquisitionCancelledError);
  assert.equal(f.waits[0].signal.aborted, true);
  f.waits[0].resolve();
  await Promise.resolve();
  assert.equal(f.reads.length, 1);
});

test('client disposal during backoff rejects all owners and consumes a late scheduler rejection', async (t) => {
  const f = setup(t);
  const handle = f.client.watch(f.source);
  await until(() => f.reads.length === 1);
  f.reads[0].reject(failure());
  await until(() => f.waits.length === 1);
  f.client.dispose();
  await assert.rejects(handle.ready, AcquisitionCancelledError);
  f.waits[0].reject(new Error('late timer failure'));
  await Promise.resolve();
  assert.equal(f.reads.length, 1);
});

test('supersession before failure or during backoff stops the old retry chain', async (t) => {
  for (const duringBackoff of [false, true]) {
    const f = setup(t);
    const handle = await seed(f);
    const old = assert.rejects(
      handle.refresh('name'),
      AcquisitionSupersededError,
    );
    await until(() => f.reads.length === 2);
    if (duringBackoff) {
      f.reads[1].reject(failure());
      await until(() => f.waits.length === 1);
    }
    const newer = handle.invalidate('name');
    await until(() => f.reads.length === 3);
    f.reads[2].resolve(rows({ name: 'newest' }));
    await newer;
    if (duringBackoff) f.waits[0].resolve();
    else f.reads[1].reject(failure());
    await old;
    assert.equal(f.reads.length, 3);
    assert.equal(handle.getSnapshot().records[0].data.name, 'newest');
    assert.equal(handle.getSnapshot().stale, false);
    assert.equal(handle.getSnapshot().error, undefined);
  }
});

test('a terminal older failure cannot mark newer fields erroneous but can mark unaffected requested fields', async (t) => {
  const f = setup(t, { retry: false });
  const handle = await seed(f);
  const old = assert.rejects(handle.refresh(), AcquisitionSupersededError);
  await until(() => f.reads.length === 2);
  const newer = handle.refresh('name');
  await until(() => f.reads.length === 3);
  f.reads[2].resolve(rows({ name: 'new' }));
  await newer;
  f.reads[1].reject(failure());
  await old;
  const statuses = handle.getSnapshot().records[0].fields;
  assert.equal(statuses.find((f) => f.path[0] === 'name').error, undefined);
  assert.equal(statuses.find((f) => f.path[0] === 'amount').error, 'offline');
  assert.equal(handle.getSnapshot().error, undefined);
});

test('Retry-After is a minimum delay; a server delay beyond the cap ends the chain', async (t) => {
  const f = setup(t, { retry: { maxDelayMs: 500 } });
  const handle = f.client.watch(f.source);
  await until(() => f.reads.length === 1);
  f.reads[0].reject(failure(true, 400));
  await until(() => f.waits.length === 1);
  assert.equal(f.waits[0].ms, 400);
  f.waits[0].resolve();
  await until(() => f.reads.length === 2);
  f.reads[1].reject(failure(true, 501));
  await assert.rejects(handle.ready, ReadTransportError);
  assert.equal(f.waits.length, 1);
});

test('policy is validated and snapshotted rather than changed by caller mutation', async (t) => {
  for (const retry of [
    { retries: -1 },
    { retries: 1.5 },
    { retries: 11 },
    { retries: NaN },
    { initialDelayMs: Infinity },
    { initialDelayMs: -1 },
    { maxDelayMs: 2_147_483_648 },
    { initialDelayMs: 500, maxDelayMs: 100 },
  ])
    assert.throws(
      () => new AcquisitionClient({ retry }),
      /retries|delay|Delay/,
    );
  assert.throws(() => new AcquisitionClient({ retry: {} }), /RetryScheduler/);
  const retry = { retries: 1 };
  const f = setup(t, { retry });
  retry.retries = 9;
  const handle = f.client.watch(f.source);
  await until(() => f.reads.length === 1);
  f.reads[0].reject(failure());
  await until(() => f.waits.length === 1);
  f.waits[0].resolve();
  await until(() => f.reads.length === 2);
  f.reads[1].reject(failure());
  await assert.rejects(handle.ready, ReadTransportError);
  assert.equal(f.reads.length, 2);
});

test('scheduler failures stop acquisition without publishing false transport field errors', async (t) => {
  for (const scheduler of [
    { random: () => NaN, wait: async () => {} },
    {
      random: () => 0.5,
      wait: async () => {
        throw failure();
      },
    },
  ]) {
    const f = setup(t, { scheduler });
    const handle = await seed(f);
    const failed = assert.rejects(
      track(handle.refresh('name')),
      /Retry scheduler failed/,
    );
    await until(() => f.reads.length === 2);
    f.reads[1].reject(failure());
    await failed;
    assert.equal(handle.getSnapshot().stale, false);
    assert.equal(handle.getSnapshot().fetching, false);
  }
});

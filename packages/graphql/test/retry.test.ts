import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createServer, type ServerResponse } from 'node:http';
import {
  AcquisitionCancelledError,
  ReadTransportError,
  type RetryScheduler,
} from '@tandrove/core';
import {
  createGraphQLClient,
  createSchema,
  type FieldType,
  type ObjectRef,
} from '../src/index.js';
import { defaultRetryScheduler } from '../src/retry-scheduler.js';

type Model = {
  Query: { item: FieldType<ObjectRef<'Item'>> };
  Item: { name: FieldType<string | null>; amount: FieldType<number> };
};
const bound = createSchema<Model>(
  'type Query { item: Item! } type Item { name: String amount: Int! }',
)
  .field('item')
  .select({ name: true, amount: true })
  .bind({}, { source: 'test', scope: 'one' });
const data = { data: { item: { __typename: 'Item', name: 'ok', amount: 10 } } };
async function server(
  t: TestContext,
  handler: (count: number, response: ServerResponse) => void,
) {
  let count = 0;
  const instance = createServer((request, response) => {
    request.resume();
    handler(++count, response);
  });
  await new Promise<void>((resolve) =>
    instance.listen(0, '127.0.0.1', resolve),
  );
  t.after(() => {
    instance.closeAllConnections();
    return new Promise<void>((resolve) => instance.close(() => resolve()));
  });
  const address = instance.address();
  assert.ok(address && typeof address !== 'string');
  return {
    endpoint: `http://127.0.0.1:${address.port}/graphql`,
    count: () => count,
  };
}
function clock() {
  const delays: number[] = [];
  const scheduler: RetryScheduler = {
    random: () => 0.5,
    wait: async (delay) => {
      delays.push(delay);
    },
  };
  return { delays, scheduler };
}

test('default GraphQL policy retries two HTTP failures, sharing the budget across consumers', async (t) => {
  const endpoint = await server(t, (count, response) => {
    response.writeHead(count < 3 ? 503 : 200, {
      'content-type': 'application/json',
    });
    response.end(JSON.stringify(data));
  });
  const f = clock();
  const client = createGraphQLClient({
    endpoint: endpoint.endpoint,
    scheduler: f.scheduler,
  });
  t.after(() => client.dispose());
  const a = client.watch(bound),
    b = client.watch(bound);
  await Promise.all([a.ready, b.ready]);
  assert.equal(endpoint.count(), 3);
  assert.deepEqual(f.delays, [125, 250]);
  assert.equal(b.getSnapshot().records?.[0]?.data['name'], 'ok');
});

test('network disconnects are classified and retried by the default HTTP transport', async (t) => {
  const endpoint = await server(t, (count, response) => {
    if (count === 1) response.destroy();
    else response.end(JSON.stringify(data));
  });
  const f = clock();
  const client = createGraphQLClient({
    endpoint: endpoint.endpoint,
    scheduler: f.scheduler,
  });
  t.after(() => client.dispose());
  await client.watch(bound).ready;
  assert.equal(endpoint.count(), 2);
  assert.deepEqual(f.delays, [125]);
});

test('connection failure after successful headers retries body transfer without retrying JSON decoding', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls > 1) return new Response(JSON.stringify(data));
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":'));
        },
        pull(controller) {
          controller.error(
            new TypeError('connection terminated while reading body'),
          );
        },
      }),
      { status: 200 },
    );
  });
  const f = clock();
  const client = createGraphQLClient({
    endpoint: 'http://localhost/graphql',
    scheduler: f.scheduler,
  });
  t.after(() => client.dispose());
  await client.watch(bound).ready;
  assert.equal(calls, 2);
  assert.deepEqual(f.delays, [125]);
});

test('authorization and other permanent HTTP failures are immediate', async (t) => {
  for (const status of [400, 401, 403, 404, 501]) {
    const endpoint = await server(t, (_count, response) => {
      response.writeHead(status);
      response.end('failure');
    });
    const f = clock();
    const client = createGraphQLClient({
      endpoint: endpoint.endpoint,
      scheduler: f.scheduler,
    });
    t.after(() => client.dispose());
    await assert.rejects(client.watch(bound).ready, ReadTransportError);
    assert.equal(endpoint.count(), 1);
    assert.deepEqual(f.delays, []);
  }
});

test('Retry-After seconds are respected and excessive date waits are not shortened into early retries', async (t) => {
  for (const after of ['2', 'Fri, 31 Dec 9999 23:59:59 GMT', '9'.repeat(400)]) {
    const endpoint = await server(t, (count, response) => {
      response.writeHead(count === 1 ? 429 : 200, { 'retry-after': after });
      response.end(JSON.stringify(data));
    });
    const f = clock();
    const client = createGraphQLClient({
      endpoint: endpoint.endpoint,
      scheduler: f.scheduler,
    });
    t.after(() => client.dispose());
    const handle = client.watch(bound);
    if (after === '2') {
      await handle.ready;
      assert.deepEqual(f.delays, [2000]);
      assert.equal(endpoint.count(), 2);
    } else {
      await assert.rejects(handle.ready, ReadTransportError);
      assert.equal(endpoint.count(), 1);
      assert.deepEqual(f.delays, []);
    }
  }
});

test('retry false disables the assembled default even for HTTP 503', async (t) => {
  const endpoint = await server(t, (_count, response) => {
    response.writeHead(503);
    response.end('busy');
  });
  const f = clock();
  const client = createGraphQLClient({
    endpoint: endpoint.endpoint,
    retry: false,
    scheduler: f.scheduler,
  });
  t.after(() => client.dispose());
  await assert.rejects(client.watch(bound).ready, ReadTransportError);
  assert.equal(endpoint.count(), 1);
  assert.deepEqual(f.delays, []);
});

test('malformed JSON, scalar decoding and GraphQL execution errors never enter the retry loop', async (t) => {
  for (const responseBody of [
    '{ malformed',
    JSON.stringify({
      data: { item: { __typename: 'Item', name: 'ok', amount: 'invalid' } },
    }),
    JSON.stringify({
      data: { item: { __typename: 'Item', name: null, amount: 10 } },
      errors: [{ message: 'name failed', path: ['item', 'name'] }],
    }),
    JSON.stringify({ errors: [{ message: 'validation failed' }] }),
  ]) {
    const endpoint = await server(t, (_count, response) => {
      response.end(responseBody);
    });
    const f = clock();
    const client = createGraphQLClient({
      endpoint: endpoint.endpoint,
      scheduler: f.scheduler,
    });
    t.after(() => client.dispose());
    await assert.rejects(client.watch(bound).ready);
    assert.equal(endpoint.count(), 1);
    assert.deepEqual(f.delays, []);
  }
});

test('header configuration exceptions do not become network retries', async (t) => {
  const f = clock();
  let calls = 0;
  const client = createGraphQLClient({
    endpoint: 'http://127.0.0.1:1/graphql',
    scheduler: f.scheduler,
    headers: () => {
      calls++;
      throw new Error('credentials unavailable');
    },
  });
  t.after(() => client.dispose());
  await assert.rejects(client.watch(bound).ready, /credentials unavailable/);
  assert.equal(calls, 1);
  assert.deepEqual(f.delays, []);
});

test('custom transports opt into retries explicitly; terminal failures map only requested fields', async (t) => {
  const f = clock();
  let failing = false,
    calls = 0;
  const client = createGraphQLClient({
    scheduler: f.scheduler,
    transport: async () => {
      calls++;
      if (failing) throw new ReadTransportError('offline', { retryable: true });
      return data;
    },
  });
  t.after(() => client.dispose());
  const handle = client.watch(bound);
  await handle.ready;
  failing = true;
  await assert.rejects(handle.refresh('name'), ReadTransportError);
  assert.equal(calls, 4);
  const snapshot = handle.getSnapshot();
  assert.equal(snapshot.records?.[0]?.data['name'], 'ok');
  assert.equal(
    snapshot.records?.[0]?.fields.find((f) => f.path[0] === 'name')?.error,
    'offline',
  );
  assert.equal(
    snapshot.records?.[0]?.fields.find((f) => f.path[0] === 'amount')?.error,
    undefined,
  );
});

test(
  'disposal clears a real platform backoff timer before its next attempt',
  { timeout: 5000 },
  async (t) => {
    let waiting!: () => void;
    const started = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    let calls = 0;
    const client = createGraphQLClient({
      retry: { initialDelayMs: 2_000_000, maxDelayMs: 2_000_000 },
      scheduler: {
        random: () => 0.5,
        wait: (delay, signal) => {
          const result = defaultRetryScheduler.wait(delay, signal);
          waiting();
          return result;
        },
      },
      transport: async () => {
        calls++;
        throw new ReadTransportError('offline', { retryable: true });
      },
    });
    t.after(() => client.dispose());
    const handle = client.watch(bound);
    await started;
    handle.dispose();
    await assert.rejects(handle.ready, AcquisitionCancelledError);
    assert.equal(calls, 1);
  },
);

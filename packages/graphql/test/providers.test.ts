import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createProviderScope, provide } from '@tandrove/core';
import {
  createGraphQLClient,
  createGraphQLTransportToken,
  createSchema,
  httpTransport,
} from '../src/index.js';

const bound = createSchema(
  'type Query { item: Item! } type Item { name: String! }',
)
  .field('item')
  .select({ name: true })
  .bind({}, { source: 'providers', scope: 'session' });

test('official HTTP factory initializes once and supports shared consumers with explicit runtime ownership', async () => {
  let reads = 0,
    created = 0,
    released = 0;
  const server = createServer((_request, response) => {
    reads++;
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({ data: { item: { __typename: 'Item', name: 'http' } } }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const transport = createGraphQLTransportToken('shared HTTP');
  const providers = createProviderScope([
    provide(transport, {
      useFactory: async ({ onCleanup }) => {
        created++;
        // Model a private listener owned by the adapter; httpTransport owns no socket pool.
        onCleanup(() => {
          released++;
        });
        return httpTransport({
          endpoint: `http://127.0.0.1:${address.port}/graphql`,
        });
      },
    }),
  ]);
  const resolved = await providers.resolve(transport);
  const client = createGraphQLClient({ transport: resolved, retry: false });
  const secondClient = createGraphQLClient({
    transport: providers.get(transport),
    retry: false,
  });
  try {
    const first = client.watch(bound),
      second = client.watch(bound);
    await Promise.all([first.ready, second.ready]);
    assert.equal(reads, 1);
    first.dispose();
    await second.refresh();
    assert.equal(released, 0);
    client.dispose();
    const independent = secondClient.watch(bound);
    await independent.ready;
    assert.equal(created, 1);
    assert.equal(independent.getSnapshot().records?.[0]?.data['name'], 'http');
    assert.equal(released, 0);
  } finally {
    client.dispose();
    secondClient.dispose();
    await providers.dispose();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  assert.equal(released, 1);
});

test('borrowed custom GraphQL transport uses the same decoder and is never automatically closed', async () => {
  const key = createGraphQLTransportToken();
  let closed = 0,
    malformed = false;
  const transport = Object.assign(
    async () =>
      malformed
        ? { data: { item: { name: 42 } } }
        : { data: { item: { __typename: 'Item', name: 'cached' } } },
    {
      dispose: () => {
        closed++;
      },
    },
  );
  const providers = createProviderScope([
    provide(key, { useValue: transport }),
  ]);
  const client = createGraphQLClient({
    transport: providers.get(key),
    retry: false,
  });
  try {
    const handle = client.watch(bound);
    await handle.ready;
    malformed = true;
    await assert.rejects(handle.refresh());
    assert.equal(handle.getSnapshot().records?.[0]?.data['name'], 'cached');
  } finally {
    client.dispose();
    await providers.dispose();
  }
  assert.equal(closed, 0);
});

test('invalid GraphQL provider capabilities fail before a client or request is created', async () => {
  const key = createGraphQLTransportToken();
  // @ts-expect-error Transport capability is a callable GraphQL operation executor.
  assert.throws(() => provide(key, { useValue: {} }), /does not satisfy/);
  const providers = createProviderScope([
    // @ts-expect-error Async factories also preserve the token capability type.
    provide(key, { useFactory: async () => ({}) }),
  ]);
  await assert.rejects(providers.resolve(key), /does not satisfy/);
  await providers.dispose();
});

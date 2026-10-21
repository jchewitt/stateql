import assert from 'node:assert/strict';
import { createGraphQLClient, createSchema } from '@tandrove/graphql';

// Run with plain Node; the controlled clock needs no server or TypeScript runtime.
let now = 0,
  expire = () => {},
  reads = 0;
const client = createGraphQLClient({
  retry: false,
  requestPolicy: { freshness: { staleTimeMs: 100, revalidate: 'on-demand' } },
  freshnessScheduler: {
    now: () => now,
    wait: () =>
      new Promise((resolve) => {
        expire = () => resolve(undefined);
      }),
  },
  transport: async () => ({
    data: { item: { __typename: 'Item', name: `version-${++reads}` } },
  }),
});
try {
  const item = createSchema(
    'type Query { item: Item! } type Item { name: String! }',
  )
    .field('item')
    .select({ name: true })
    .bind({}, { source: 'example', scope: 'session' });
  const a = client.watch(item),
    b = client.watch(item);
  await Promise.all([a.ready, b.ready]);
  now = 100;
  expire();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(a.getSnapshot().stale, true);
  assert.equal(a.getSnapshot().records?.[0]?.data['name'], 'version-1');
  assert.equal(reads, 1);
  await a.ensure();
  assert.equal(b.getSnapshot().records?.[0]?.data['name'], 'version-2');
  assert.equal(b.getSnapshot().stale, false);
  console.log(
    'Freshness: expired values stay visible; on-demand acquisition updates both owners.',
  );
} finally {
  client.dispose();
}

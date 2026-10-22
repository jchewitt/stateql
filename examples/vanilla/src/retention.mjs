import assert from 'node:assert/strict';
import { createGraphQLClient, createSchema } from '@tandrove/graphql';

let reads = 0;
const client = createGraphQLClient({
  requestPolicy: { retentionMs: 0 },
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
  const first = client.watch(item),
    second = client.watch(item);
  await Promise.all([first.ready, second.ready]);
  assert.equal(reads, 1);
  first.dispose();
  await second.ensure();
  assert.equal(reads, 1);
  const snapshot = second.getSnapshot();
  second.dispose();
  const reopened = client.watch(item);
  assert.equal(reopened.getSnapshot().records, undefined);
  await reopened.ready;
  assert.equal(reads, 2);
  assert.equal(reopened.getSnapshot().records?.[0]?.data['name'], 'version-2');
  assert.equal(second.getSnapshot(), snapshot);
  console.log(
    'Retention: active owners share data; final departure evicts, and reopening acquires fresh state.',
  );
} finally {
  client.dispose();
}

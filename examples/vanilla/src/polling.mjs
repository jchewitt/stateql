import assert from 'node:assert/strict';
import { createGraphQLClient, createSchema } from '@tandrove/graphql';

// Plain JavaScript with an injected clock: no server, framework, or real-time delay.
let now = 0,
  reads = 0;
/** @type {string[]} */
const queries = [];
/** @type {{ signal: import('@tandrove/core').CancellationSignal, fire: () => void } | undefined} */
let timer;
const client = createGraphQLClient({
  retry: false,
  requestPolicy: { polling: { everyMs: 100 } },
  pollingScheduler: {
    now: () => now,
    wait: (_ms, signal) =>
      new Promise((resolve) => {
        timer = { signal, fire: () => resolve(undefined) };
      }),
  },
  transport: async (operation) => {
    queries.push(operation.query);
    reads++;
    return {
      data: {
        item: {
          __typename: 'Item',
          name: `version-${reads}`,
          description: `description-${reads}`,
        },
      },
    };
  },
});
try {
  const item = createSchema(
    'type Query { item: Item! } type Item { name: String!, description: String! }',
  )
    .field('item')
    .select({ name: true, description: true })
    .bind({}, { source: 'polling-example', scope: 'session' });
  const first = client.watch(item),
    second = client.watch(item);
  await Promise.all([first.ready, second.ready]);
  assert.equal(reads, 1);
  // Configuring an interval alone does not start polling. Each owner opts in.
  const stopFirst = first.poll({ target: 'name' });
  const stopSecond = second.poll({ target: 'name' });
  for (let index = 0; index < 30; index++) await Promise.resolve();
  assert.ok(timer);
  now = 100;
  timer.fire();
  for (let index = 0; index < 100; index++) await Promise.resolve();
  assert.equal(reads, 2);
  assert.match(queries[1] ?? '', /\bname\b/);
  assert.doesNotMatch(queries[1] ?? '', /\bdescription\b/);
  assert.equal(first.getSnapshot().records?.[0]?.data['name'], 'version-2');
  assert.equal(second.getSnapshot().records?.[0]?.data['name'], 'version-2');
  assert.equal(
    second.getSnapshot().records?.[0]?.data['description'],
    'description-1',
  );
  stopFirst();
  first.dispose();
  assert.equal(timer.signal.aborted, false);
  stopSecond();
  stopSecond();
  assert.equal(timer.signal.aborted, true);
  console.log(
    'Polling: two owners share one field refresh, keep siblings cached, and stop independently.',
  );
} finally {
  client.dispose();
}

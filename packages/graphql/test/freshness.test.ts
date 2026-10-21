import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CancellationSignal, FreshnessScheduler } from '@tandrove/core';
import {
  createGraphQLClient,
  createSchema,
  type FieldType,
  type ObjectRef,
} from '../src/index.js';
type Model = {
  Query: { item: FieldType<ObjectRef<'Item'>> };
  Item: { name: FieldType<string> };
};
const bound = createSchema<Model>(
  'type Query { item: Item! } type Item { name: String! }',
)
  .field('item')
  .select({ name: true })
  .bind({}, { source: 'freshness', scope: 'one' });
const flush = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};
test('GraphQL forwards shared policy, fresh membership and active revalidation through its normal transport', async (t) => {
  let now = 0,
    reads = 0;
  const timers: { signal: CancellationSignal; fire: () => void }[] = [];
  const clock: FreshnessScheduler = {
    now: () => now,
    wait: (_ms, signal) =>
      new Promise<void>((resolve) => timers.push({ signal, fire: resolve })),
  };
  const client = createGraphQLClient({
    retry: false,
    freshnessScheduler: clock,
    requestPolicyGroups: {
      forms: { freshness: { staleTimeMs: 100, revalidate: 'active' } },
    },
    transport: async () => ({
      data: { item: { __typename: 'Item', name: `name-${++reads}` } },
    }),
  });
  t.after(() => client.dispose());
  const a = client.watch(bound, { group: 'forms' }),
    b = client.watch(bound, { group: 'forms' });
  await Promise.all([a.ready, b.ready]);
  assert.equal(reads, 1);
  now = 100;
  [...timers]
    .reverse()
    .find((timer) => !timer.signal.aborted)!
    .fire();
  await flush();
  assert.equal(reads, 2);
  assert.equal(a.getSnapshot().records?.[0]?.data['name'], 'name-2');
  assert.equal(b.getSnapshot().stale, false);
  a.dispose();
  const live = [...timers].reverse().find((timer) => !timer.signal.aborted)!;
  assert.ok(live);
  b.dispose();
  assert.equal(live.signal.aborted, true);
});
test('GraphQL supplies its default monotonic clock with retries disabled and false overrides expiry', async (t) => {
  let reads = 0;
  const client = createGraphQLClient({
    retry: false,
    requestPolicy: { freshness: { staleTimeMs: 5 } },
    transport: async () => {
      reads++;
      return { data: { item: { __typename: 'Item', name: 'value' } } };
    },
  });
  t.after(() => client.dispose());
  const a = client.watch(bound);
  await a.ready;
  await new Promise<void>((resolve) => {
    if (a.getSnapshot().stale) resolve();
    else {
      const off = a.subscribe(() => {
        if (a.getSnapshot().stale) {
          off();
          resolve();
        }
      });
    }
  });
  assert.equal(reads, 1);
  assert.equal(a.getSnapshot().records?.[0]?.data['name'], 'value');
  const offClient = createGraphQLClient({
    requestPolicy: { freshness: { staleTimeMs: 5 } },
    freshnessScheduler: {
      now: () => {
        throw Error('disabled');
      },
      wait: () => {
        throw Error('disabled');
      },
    },
    transport: async () => ({
      data: { item: { __typename: 'Item', name: 'off' } },
    }),
  });
  t.after(() => offClient.dispose());
  const b = offClient.watch(bound, {
    requestPolicy: { freshness: { staleTimeMs: false } },
  });
  await b.ready;
  assert.equal(b.getSnapshot().stale, false);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { CancellationSignal, MonotonicScheduler } from '@tandrove/core';
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
const definition = createSchema<Model>(
  'type Query { item: Item! } type Item { name: String! }',
)
  .field('item')
  .select({ name: true });
const bound = definition.bind({}, { source: 'retention', scope: 'one' });
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

test('GraphQL retention uses group bindings, shared ownership and scoped eviction', async (t) => {
  let now = 0,
    reads = 0;
  const timers: { signal: CancellationSignal; fire: () => void; ms: number }[] =
    [];
  const clock: MonotonicScheduler = {
    now: () => now,
    wait: (ms, signal) =>
      new Promise<void>((resolve) =>
        timers.push({ ms, signal, fire: resolve }),
      ),
  };
  const client = createGraphQLClient({
    retry: false,
    retentionScheduler: clock,
    requestPolicyGroups: { forms: { retentionMs: 100 } },
    transport: async () => ({
      data: { item: { __typename: 'Item', name: `value-${++reads}` } },
    }),
  });
  t.after(() => client.dispose());
  const a = client.watch(bound, { group: 'forms' }),
    b = client.watch(bound, { group: 'forms' });
  await Promise.all([a.ready, b.ready]);
  const other = client.watch(
    definition.bind({}, { source: 'retention', scope: 'two' }),
    { group: 'forms' },
  );
  await other.ready;
  a.dispose();
  assert.equal(timers.length, 0);
  b.dispose();
  assert.equal(timers[0]!.ms, 100);
  now = 100;
  timers[0]!.fire();
  await flush();
  const next = client.watch(bound, { requestPolicy: { retentionMs: 0 } });
  assert.equal(next.getSnapshot().records, undefined);
  await next.ready;
  assert.equal(reads, 3);
  assert.equal(other.getSnapshot().records?.[0]?.data['name'], 'value-2');
  assert.equal(next.getSnapshot().records?.[0]?.data['name'], 'value-3');
});

test('GraphQL supplies platform retention scheduling without retries or freshness enabled', async (t) => {
  let reads = 0;
  const client = createGraphQLClient({
    retry: false,
    requestPolicy: { retentionMs: 5 },
    transport: async () => ({
      data: { item: { __typename: 'Item', name: `value-${++reads}` } },
    }),
  });
  t.after(() => client.dispose());
  const a = client.watch(bound);
  await a.ready;
  a.dispose();
  await delay(20);
  const b = client.watch(bound);
  assert.equal(b.getSnapshot().records, undefined);
  await b.ready;
  assert.equal(reads, 2);
});

test('GraphQL false override avoids clock use and zero retention needs no platform timer', async (t) => {
  let reads = 0;
  const client = createGraphQLClient({
    requestPolicy: { retentionMs: 10 },
    retentionScheduler: {
      now: () => {
        throw Error('disabled');
      },
      wait: () => {
        throw Error('disabled');
      },
    },
    transport: async () => ({
      data: { item: { __typename: 'Item', name: `value-${++reads}` } },
    }),
  });
  t.after(() => client.dispose());
  const binding = { requestPolicy: { retentionMs: false as const } };
  const a = client.watch(bound, binding);
  await a.ready;
  a.dispose();
  const b = client.watch(bound, binding);
  await b.ready;
  assert.equal(reads, 1);
  const zero = definition.bind({}, { source: 'retention', scope: 'zero' });
  const c = client.watch(zero, { requestPolicy: { retentionMs: 0 } });
  await c.ready;
  c.dispose();
  const d = client.watch(zero, { requestPolicy: { retentionMs: 0 } });
  assert.equal(d.getSnapshot().records, undefined);
  await d.ready;
  assert.equal(reads, 3);
});

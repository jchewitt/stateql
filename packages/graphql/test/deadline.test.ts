import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ReadTimeoutError,
  type CancellationSignal,
  type DelayScheduler,
} from '@tandrove/core';
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
  .bind({}, { source: 'deadline', scope: 'one' });
async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

test('GraphQL forwards group/resource policy and deadline abort through the transport boundary', async (t) => {
  const timers: { ms: number; signal: CancellationSignal; fire: () => void }[] =
    [];
  const deadlineScheduler: DelayScheduler = {
    wait: (ms, signal) =>
      new Promise<void>((resolve) =>
        timers.push({ ms, signal, fire: resolve }),
      ),
  };
  const reads: { signal: AbortSignal; resolve: (data: unknown) => void }[] = [];
  const client = createGraphQLClient({
    retry: false,
    requestPolicy: { requestTimeoutMs: 1000 },
    requestPolicyGroups: { form: { requestTimeoutMs: 100 } },
    deadlineScheduler,
    transport: (_operation, context) =>
      new Promise((resolve) => {
        assert.ok(context);
        reads.push({ signal: context.signal, resolve });
      }),
  });
  t.after(() => client.dispose());
  const a = client.watch(bound, { group: 'form' });
  const b = client.watch(bound, { requestPolicy: { requestTimeoutMs: 100 } });
  await flush();
  assert.equal(reads.length, 1);
  assert.equal(timers[0]!.ms, 100);
  const failures = [
    assert.rejects(a.ready, ReadTimeoutError),
    assert.rejects(b.ready, ReadTimeoutError),
  ];
  timers[0]!.fire();
  await Promise.all(failures);
  assert.equal(reads[0]!.signal.aborted, true);
  assert.equal(timers[0]!.signal.aborted, true);
  reads[0]!.resolve({ data: { item: { __typename: 'Item', name: 'late' } } });
  await flush();
  assert.equal(a.getSnapshot().records, undefined);
  const ready = a.ensure();
  await flush();
  reads[1]!.resolve({ data: { item: { __typename: 'Item', name: 'new' } } });
  await ready;
  assert.equal(b.getSnapshot().records?.[0]?.data['name'], 'new');
  assert.equal(timers[1]!.signal.aborted, true);
});

test('assembled GraphQL client supplies its platform timer even when retries are disabled', async (t) => {
  let signal: AbortSignal | undefined;
  const client = createGraphQLClient({
    retry: false,
    requestPolicy: { requestTimeoutMs: 5 },
    transport: (_operation, context) => {
      signal = context?.signal;
      return new Promise(() => {});
    },
  });
  t.after(() => client.dispose());
  await assert.rejects(client.watch(bound).ready, ReadTimeoutError);
  assert.equal(signal?.aborted, true);
});

test('resource false disables inherited GraphQL deadline and policy rejection starts no transport', async (t) => {
  let reads = 0;
  const client = createGraphQLClient({
    requestPolicy: { requestTimeoutMs: 100 },
    deadlineScheduler: {
      wait() {
        throw new Error('must be disabled');
      },
    },
    transport: async () => {
      reads++;
      return { data: { item: { __typename: 'Item', name: 'ok' } } };
    },
  });
  t.after(() => client.dispose());
  assert.throws(
    () => client.watch(bound, { group: 'missing' }),
    /Unknown request policy group/,
  );
  assert.equal(reads, 0);
  await client.watch(bound, { requestPolicy: { requestTimeoutMs: false } })
    .ready;
  assert.equal(reads, 1);
});

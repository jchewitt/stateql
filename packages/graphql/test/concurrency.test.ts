import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import {
  AcquisitionCancelledError,
  AcquisitionSupersededError,
} from '@launch-echo/stateql-core';
import {
  createSchema,
  createGraphQLClient,
  type FieldType,
  type ObjectRef,
  type PreparedOperation,
} from '../src/index.js';

type Model = {
  Query: { item: FieldType<ObjectRef<'Item'>> };
  Item: { name: FieldType<string | null>; amount: FieldType<number> };
};
const model = createSchema<Model>(
  'type Query { item: Item! } type Item { name: String amount: Int! }',
);
const scope = { source: 'test', scope: 'session' };
const base = model.field('item').select({ name: true, amount: true });
const response = (data: Record<string, unknown>) => ({
  data: { item: { __typename: 'Item', ...data } },
});
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail('Expected asynchronous progress.');
}
function controlled() {
  const reads: {
    operation: PreparedOperation;
    signal: AbortSignal;
    resolve(value: unknown): void;
  }[] = [];
  const client = createGraphQLClient({
    transport: (operation, context) =>
      new Promise((resolve) => {
        assert.ok(context?.signal);
        reads.push({ operation, signal: context.signal, resolve });
      }),
  });
  return { client, reads };
}

test('a newer aliased GraphQL refresh protects its canonical field from a late full response', async (t) => {
  const f = controlled();
  t.after(() => f.client.dispose());
  const full = f.client.watch(base.bind({}, scope));
  await until(() => f.reads.length === 1);
  f.reads[0]!.resolve(response({ name: 'old', amount: 10 }));
  await full.ready;
  const alias = f.client.watch(
    model
      .field('item')
      .select({ name: { as: 'title' } })
      .bind({}, scope),
  );
  await alias.ready;
  const old = assert.rejects(full.refresh(), AcquisitionSupersededError);
  await until(() => f.reads.length === 2);
  const newer = alias.invalidate('title');
  await until(() => f.reads.length === 3);
  assert.match(f.reads[2]!.operation.query, /title: name/);
  assert.doesNotMatch(f.reads[2]!.operation.query, /amount/);
  f.reads[2]!.resolve(response({ title: 'new' }));
  await newer;
  f.reads[1]!.resolve(response({ name: 'obsolete', amount: 20 }));
  await old;
  assert.equal(full.getSnapshot().records?.[0]?.data['name'], 'new');
  assert.equal(full.getSnapshot().records?.[0]?.data['amount'], 20);
  assert.equal(alias.getSnapshot().records?.[0]?.data['title'], 'new');
  assert.equal(alias.getSnapshot().error, undefined);
});

test('GraphQL shares one request and aborts only after its final interested owner leaves', async (t) => {
  const f = controlled();
  t.after(() => f.client.dispose());
  const a = f.client.watch(base.bind({}, scope));
  const b = f.client.watch(base.bind({}, scope));
  await until(() => f.reads.length === 1);
  a.dispose();
  await assert.rejects(a.ready, AcquisitionCancelledError);
  assert.equal(f.reads[0]!.signal.aborted, false);
  b.dispose();
  await assert.rejects(b.ready, AcquisitionCancelledError);
  assert.equal(f.reads[0]!.signal.aborted, true);
  const c = f.client.watch(base.bind({}, scope));
  await until(() => f.reads.length === 2);
  f.reads[1]!.resolve(response({ name: 'replacement', amount: 20 }));
  await c.ready;
  f.reads[0]!.resolve(response({ name: 'late', amount: 99 }));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(c.getSnapshot().records?.[0]?.data['name'], 'replacement');
});

test(
  'default HTTP transport aborts the actual pending request on final disposal',
  { timeout: 10000 },
  async (t) => {
    let began!: () => void, closed!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const disconnected = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const server = createServer((request, reply) => {
      request.resume();
      reply.once('close', closed);
      began();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    t.after(() => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const client = createGraphQLClient({
      endpoint: `http://127.0.0.1:${address.port}/graphql`,
    });
    t.after(() => client.dispose());
    const handle = client.watch(base.bind({}, scope));
    await started;
    handle.dispose();
    await assert.rejects(handle.ready, AcquisitionCancelledError);
    await disconnected;
  },
);

test('scope disposal and late results do not cancel or overwrite another scope', async (t) => {
  const f = controlled();
  t.after(() => f.client.dispose());
  const a = f.client.watch(base.bind({}, { ...scope, scope: 'A' }));
  const b = f.client.watch(base.bind({}, { ...scope, scope: 'B' }));
  await until(() => f.reads.length === 2);
  a.dispose();
  await assert.rejects(a.ready, AcquisitionCancelledError);
  assert.equal(f.reads[0]!.signal.aborted, true);
  assert.equal(f.reads[1]!.signal.aborted, false);
  f.reads[1]!.resolve(response({ name: 'B', amount: 20 }));
  await b.ready;
  f.reads[0]!.resolve(response({ name: 'A', amount: 99 }));
  await Promise.resolve();
  assert.equal(b.getSnapshot().records?.[0]?.data['name'], 'B');
});

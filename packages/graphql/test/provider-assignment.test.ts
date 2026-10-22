import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { provide, createProviderScope } from '@tandrove/core';
import {
  createSchema,
  createGraphQLClient,
  createGraphQLTransportToken,
  httpTransport,
  type GraphQLTransport,
} from '../src/index.js';

const resource = createSchema(
  'type Query { item(id: ID!): Item! } type Item { name: String! amount: Int! }',
)
  .field('item')
  .select({ name: true, amount: true });
const bound = (id = '1', scope = 'session') =>
  resource.bind({ item: { id } }, { scope, source: 'assignment' });
const transport =
  (value: string, calls: string[]): GraphQLTransport =>
  async (operation) => {
    calls.push(operation.query);
    return { data: { item: { __typename: 'Item', name: value, amount: 1 } } };
  };

test('global/group/resource transport assignment preserves shared identity and selected invalidation', async (t) => {
  const aCalls: string[] = [],
    bCalls: string[] = [];
  const a = transport('a', aCalls),
    b = transport('b', bCalls);
  const first = createGraphQLTransportToken(),
    alias = createGraphQLTransportToken(),
    second = createGraphQLTransportToken();
  const scope = createProviderScope([
    provide(first, { useValue: a }),
    provide(alias, { useValue: a }),
    provide(second, { useValue: b }),
  ]);
  const client = createGraphQLClient({
    providerScope: scope,
    providers: { transport: first },
    resourceGroups: {
      other: { providers: { transport: second } },
      same: { providers: { transport: alias } },
    },
    retry: false,
  });
  t.after(async () => {
    client.dispose();
    await scope.dispose();
  });
  const one = client.watch(bound()),
    same = client.watch(bound(), { group: 'same' }),
    two = client.watch(bound('2'), { group: 'other' });
  await Promise.all([one.ready, same.ready, two.ready]);
  assert.equal(one.stateAddress, same.stateAddress);
  assert.equal(aCalls.length, 1);
  assert.equal(bCalls.length, 1);
  assert.equal(two.getSnapshot().records![0]!.data.name, 'b');
  assert.throws(
    () => client.watch(bound(), { group: 'other' }),
    /same authority/,
  );
  const override = client.watch(bound(), {
    group: 'other',
    providers: { transport: first },
  });
  await override.ready;
  await one.invalidate('name');
  assert.match(aCalls.at(-1)!, /name/);
  assert.doesNotMatch(aCalls.at(-1)!, /amount/);
  assert.equal(same.getSnapshot().records![0]!.data.amount, 1);
});

test('provider and policy groups resolve together, including legacy policy-only groups', async (t) => {
  const calls: string[] = [],
    a = transport('a', calls),
    token = createGraphQLTransportToken();
  const scope = createProviderScope([provide(token, { useValue: a })]);
  const config = {
    providerScope: scope,
    providers: { transport: token },
    requestPolicy: { retentionMs: 0 },
    resourceGroups: {
      kept: { requestPolicy: { retentionMs: false as const } },
    },
    requestPolicyGroups: { legacy: { retentionMs: false as const } },
    retry: false as const,
  };
  const client = createGraphQLClient(config);
  t.after(async () => {
    client.dispose();
    await scope.dispose();
  });
  config.providers.transport = createGraphQLTransportToken(
    'unregistered mutation',
  );
  const one = client.watch(bound(), { group: 'kept' });
  await one.ready;
  await client.watch(bound(), { group: 'legacy' }).ready;
  assert.throws(() => client.watch(bound()), /same effective retentionMs/);
  await client.watch(bound(), { requestPolicy: { retentionMs: false } }).ready;
  assert.equal(calls.length, 1);
});

test('disabled transport does not fall back to direct transport, and re-enable uses ready providers', async (t) => {
  const calls: string[] = [],
    a = transport('a', calls),
    token = createGraphQLTransportToken();
  let starts = 0;
  const scope = createProviderScope([
    provide(token, {
      useFactory: async () => {
        starts++;
        return a;
      },
    }),
  ]);
  const client = createGraphQLClient({
    transport: a,
    providerScope: scope,
    resourceGroups: {
      off: { providers: { transport: false } },
      on: { providers: { transport: token } },
    },
    retry: false,
  });
  t.after(async () => {
    client.dispose();
    await scope.dispose();
  });
  assert.throws(() => client.watch(bound(), { group: 'off' }), /disabled/);
  assert.throws(() => client.watch(bound(), { group: 'on' }), /ready|resolve/i);
  assert.equal(starts, 0);
  assert.equal(calls.length, 0);
  await scope.resolve(token);
  const one = client.watch(bound());
  await one.ready;
  await client.watch(bound(), { group: 'off', providers: { transport: token } })
    .ready;
  assert.equal(calls.length, 1);
});

test('authority is retained while inactive, released on eviction, and isolated by canonical scope', async (t) => {
  const a = transport('a', []),
    b = transport('b', []),
    token = createGraphQLTransportToken();
  const scope = createProviderScope([provide(token, { useValue: b })]);
  const client = createGraphQLClient({
    transport: a,
    providerScope: scope,
    retry: false,
  });
  t.after(async () => {
    client.dispose();
    await scope.dispose();
  });
  const one = client.watch(bound());
  await one.ready;
  one.dispose();
  assert.throws(
    () => client.watch(bound(), { providers: { transport: token } }),
    /same authority/,
  );
  const isolated = client.watch(bound('1', 'another session'), {
    providers: { transport: token },
  });
  await isolated.ready;
  const transient = client.watch(bound('2'), {
    requestPolicy: { retentionMs: 0 },
  });
  await transient.ready;
  transient.dispose();
  const replacement = client.watch(bound('2'), {
    providers: { transport: token },
    requestPolicy: { retentionMs: 0 },
  });
  await replacement.ready;
  assert.equal(replacement.getSnapshot().records![0]!.data.name, 'b');
});

test('assigned official HTTP transport uses ordinary operation generation and decoding', async (t) => {
  const queries: string[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      queries.push((JSON.parse(body) as { query: string }).query);
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          data: { item: { __typename: 'Item', name: 'http', amount: 2 } },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const token = createGraphQLTransportToken(),
    scope = createProviderScope([
      provide(token, {
        useValue: httpTransport({
          endpoint: `http://127.0.0.1:${address.port}/graphql`,
        }),
      }),
    ]);
  const client = createGraphQLClient({
    providerScope: scope,
    providers: { transport: token },
    retry: false,
  });
  t.after(async () => {
    client.dispose();
    await scope.dispose();
  });
  const one = client.watch(bound());
  await one.ready;
  await one.refresh('name');
  assert.equal(one.getSnapshot().records![0]!.data.name, 'http');
  assert.doesNotMatch(queries[1]!, /amount/);
});

test('assigned custom transport cannot bypass GraphQL validation', async (t) => {
  const token = createGraphQLTransportToken(),
    scope = createProviderScope([
      provide(token, {
        useValue: async () => ({
          data: { item: { __typename: 'Item', name: 42, amount: 1 } },
        }),
      }),
    ]);
  const client = createGraphQLClient({
    providerScope: scope,
    providers: { transport: token },
    retry: false,
  });
  t.after(async () => {
    client.dispose();
    await scope.dispose();
  });
  await assert.rejects(client.watch(bound()).ready);
});

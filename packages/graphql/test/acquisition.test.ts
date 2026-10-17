import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute } from 'graphql';
import {
  createGraphQLClient,
  createSchema,
  type GraphQLTransport,
  type PreparedOperation,
  type FieldType,
  type ObjectRef,
} from '../src/index.js';
import { schema as generated } from '../../../examples/query-planner/src/generated/billing.js';
import { schema, createRoot } from '../../../apps/billing-api/src/schema.js';
import { BillingFixture } from '../../../apps/billing-api/src/fixture.js';
import { listen } from '../../../apps/billing-api/src/server.js';

const resource = generated.field('billing').field('invoices');
const base = resource.select({ accountId: true });
const scope = { source: 'billing-api', scope: 'session' };
const args = { billing: { tenantId: 'A' } };
function fixtureTransport(fixture = new BillingFixture()) {
  const requests: PreparedOperation[] = [];
  const transport: GraphQLTransport = async (operation) => {
    requests.push(operation);
    return execute({
      schema,
      document: operation.document,
      variableValues: operation.variables,
      rootValue: createRoot(fixture, fixture.snapshot(), false),
    });
  };
  return { fixture, requests, transport };
}

test('concurrent identical consumers reuse one acquisition; an extension fetches only missing fields', async () => {
  const { transport, requests, fixture } = fixtureTransport();
  const client = createGraphQLClient({ transport });
  const first = client.watch(base.bind(args, scope));
  const second = client.watch(base.bind(args, scope));
  await Promise.all([first.ready, second.ready]);
  assert.equal(requests.length, 1);
  const old = first.getSnapshot();
  assert.equal(old.records?.[0]?.data['accountId'], 'A-ledger-1-v1');
  fixture.advance('A');
  fixture.reverse('A');
  const extended = client.watch(
    base
      .extend({ amountCents: true, user: { select: { name: true } } })
      .bind(args, scope),
  );
  await extended.ready;
  assert.equal(requests.length, 2);
  assert.doesNotMatch(requests[1]!.query, /accountId/);
  assert.match(requests[1]!.query, /amountCents/);
  assert.match(requests[1]!.query, /name/);
  assert.equal(first.getSnapshot(), old);
  assert.equal(
    extended.getSnapshot().records?.[0]?.data['accountId'],
    'A-ledger-1-v1',
  );
  assert.equal(extended.getSnapshot().records?.[0]?.data['amountCents'], 13500);
  await extended.ensure();
  assert.equal(requests.length, 2);
  client.dispose();
});

test('aliases reuse canonical fields and argument/client scopes do not leak values', async () => {
  const { transport, requests } = fixtureTransport();
  const client = createGraphQLClient({ transport });
  const first = client.watch(base.bind(args, scope));
  await first.ready;
  const alias = client.watch(
    resource.select({ accountId: { as: 'ledger' } }).bind(args, scope),
  );
  await alias.ready;
  assert.equal(requests.length, 1);
  assert.equal(
    alias.getSnapshot().records?.[0]?.data['ledger'],
    'A-ledger-1-v1',
  );
  const other = client.watch(base.bind({ billing: { tenantId: 'B' } }, scope));
  await other.ready;
  assert.equal(
    other.getSnapshot().records?.[0]?.data['accountId'],
    'B-ledger-1-v1',
  );
  const separate = client.watch(base.bind(args, { ...scope, scope: 'other' }));
  await separate.ready;
  assert.equal(requests.length, 3);
  client.dispose();
});

test('initial failure is observable and ensure retries without automatic retry loops', async () => {
  const { transport, requests } = fixtureTransport();
  let fail = true;
  const client = createGraphQLClient({
    transport: async (operation) => {
      if (fail) throw new Error('offline');
      return transport(operation);
    },
  });
  const handle = client.watch(base.bind(args, scope));
  await assert.rejects(handle.ready, /offline/);
  assert.equal(handle.getSnapshot().error, 'offline');
  assert.equal(handle.getSnapshot().fetching, false);
  assert.equal(handle.getSnapshot().records, undefined);
  fail = false;
  await handle.ensure();
  assert.equal(handle.getSnapshot().error, undefined);
  assert.equal(handle.getSnapshot().complete, true);
  assert.equal(requests.length, 1);
  client.dispose();
});

test('partial errors, malformed scalars and missing selected fields cannot corrupt an existing view', async () => {
  for (const mode of [
    'error',
    'scalar',
    'missing',
    'duplicate',
    'membership',
  ]) {
    const { transport } = fixtureTransport();
    let mutate = false;
    const client = createGraphQLClient({
      transport: async (operation) => {
        const result = JSON.parse(
          JSON.stringify(await transport(operation)),
        ) as {
          data: { billing: { invoices: Record<string, unknown>[] } };
          errors?: unknown[];
        };
        if (mutate) {
          if (mode === 'error')
            result.errors = [{ message: 'partial failure' }];
          if (mode === 'scalar')
            result.data.billing.invoices[0]!['amountCents'] = '123';
          if (mode === 'missing')
            delete result.data.billing.invoices[0]!['amountCents'];
          if (mode === 'duplicate')
            result.data.billing.invoices.push(result.data.billing.invoices[0]!);
          if (mode === 'membership') result.data.billing.invoices.pop();
        }
        return result;
      },
    });
    const first = client.watch(base.bind(args, scope));
    await first.ready;
    const old = first.getSnapshot();
    mutate = true;
    const extended = client.watch(
      base.extend({ amountCents: true }).bind(args, scope),
    );
    await assert.rejects(extended.ready);
    assert.equal(first.getSnapshot(), old);
    assert.equal(
      extended.getSnapshot().records?.[0]?.data['amountCents'],
      undefined,
    );
    assert.equal(extended.getSnapshot().complete, false);
    client.dispose();
  }
});

test('a disposed owner cannot receive late updates while another owner can reuse the read', async () => {
  const { transport, requests } = fixtureTransport();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = createGraphQLClient({
    transport: async (operation) => {
      await gate;
      return transport(operation);
    },
  });
  const first = client.watch(base.bind(args, scope));
  const second = client.watch(base.bind(args, scope));
  await Promise.resolve();
  first.dispose();
  const frozen = first.getSnapshot();
  release();
  await assert.rejects(first.ready, /disposed/);
  await second.ready;
  assert.equal(first.getSnapshot(), frozen);
  assert.equal(second.getSnapshot().complete, true);
  assert.equal(requests.length, 1);
  client.dispose();
  await assert.rejects(second.ensure(), /disposed/);
});

test('disposing a client rejects late work and isolates a new client', async () => {
  const { transport } = fixtureTransport();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = createGraphQLClient({
    transport: async (operation) => {
      await gate;
      return transport(operation);
    },
  });
  const handle = client.watch(base.bind(args, scope));
  await Promise.resolve();
  client.dispose();
  const frozen = handle.getSnapshot();
  release();
  await assert.rejects(handle.ready, /owners/);
  assert.equal(handle.getSnapshot(), frozen);
  assert.throws(() => client.watch(base.bind(args, scope)), /disposed/);
});

test('listener failures are reported separately and do not cause retries or read failures', async () => {
  const { transport, requests } = fixtureTransport();
  const errors: unknown[] = [];
  const client = createGraphQLClient({
    transport,
    onListenerError: (error) => errors.push(error),
  });
  const handle = client.watch(base.bind(args, scope));
  handle.subscribe(() => {
    throw new Error('UI failed');
  });
  await handle.ready;
  assert.equal(handle.getSnapshot().complete, true);
  assert.equal(handle.getSnapshot().error, undefined);
  assert.ok(errors.length);
  assert.equal(requests.length, 1);
  client.dispose();
});

test('default HTTP transport runs against the real billing fixture', async (t) => {
  const api = await listen(0);
  t.after(api.close);
  const client = createGraphQLClient({ endpoint: `${api.url}/graphql` });
  t.after(() => client.dispose());
  const handle = client.watch(base.bind(args, scope));
  await handle.ready;
  assert.equal(handle.getSnapshot().records?.length, 2);
  assert.equal(handle.getSnapshot().complete, true);
});

test('nullable embedded objects and scalar lists decode; unsupported nested object lists fail before transport', async () => {
  type Model = {
    Query: { item: FieldType<ObjectRef<'Item'>> };
    Item: {
      tags: FieldType<readonly string[]>;
      user: FieldType<ObjectRef<'User'> | null>;
      users: FieldType<readonly ObjectRef<'User'>[]>;
    };
    User: { id: FieldType<string>; name: FieldType<string> };
  };
  const model = createSchema<Model>(
    'type Query { item: Item! } type Item { tags: [String!]! user: User users: [User!]! } type User { id: ID! name: String! }',
    { identities: { User: ['id'] } },
  );
  let calls = 0;
  const client = createGraphQLClient({
    transport: async () => {
      calls++;
      return {
        data: { item: { __typename: 'Item', tags: ['a', 'b'], user: null } },
      };
    },
  });
  const handle = client.watch(
    model
      .field('item')
      .select({ tags: true, user: { select: { name: true } } })
      .bind({}, scope),
  );
  await handle.ready;
  assert.deepEqual(handle.getSnapshot().records?.[0]?.data['tags'], ['a', 'b']);
  assert.equal(handle.getSnapshot().records?.[0]?.data['user'], null);
  assert.throws(
    () =>
      client.watch(
        model
          .field('item')
          .select({ users: { select: { name: true } } })
          .bind({}, scope),
      ),
    /Nested object-list/,
  );
  assert.equal(calls, 1);
  client.dispose();
});

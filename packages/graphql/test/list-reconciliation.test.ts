import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute } from 'graphql';
import { createGraphQLClient, type PreparedOperation } from '../src/index.js';
import { schema as generated } from '../../../examples/query-planner/src/generated/billing.js';
import { schema, createRoot } from '../../../apps/billing-api/src/schema.js';
import { BillingFixture } from '../../../apps/billing-api/src/fixture.js';
import { listen } from '../../../apps/billing-api/src/server.js';

const resource = generated.field('billing').field('invoices');
const definition = resource.select({
  accountId: true,
  amountCents: true,
  status: true,
});
const scope = { source: 'billing-api', scope: 'session' };
const args = { billing: { tenantId: 'A' } };

function fixture() {
  const server = new BillingFixture();
  const data = server.snapshot();
  const requests: PreparedOperation[] = [];
  const client = createGraphQLClient({
    transport: async (operation) => {
      requests.push(operation);
      return execute({
        schema,
        document: operation.document,
        variableValues: operation.variables,
        rootValue: createRoot(server, data, false),
      });
    },
  });
  return { client, data, requests };
}

test('GraphQL narrow list refresh patches by composite identity; explicit list refresh replaces membership and order', async (t) => {
  const { client, data, requests } = fixture();
  t.after(() => client.dispose());
  const full = client.watch(definition.bind(args, scope));
  const alias = client.watch(
    resource.select({ accountId: { as: 'ledger' } }).bind(args, scope),
  );
  const other = client.watch(
    definition.bind({ billing: { tenantId: 'B' } }, scope),
  );
  await Promise.all([full.ready, alias.ready, other.ready]);
  const otherBefore = other.getSnapshot(),
    stateAddress = full.stateAddress;
  const retained = {
    ...data.A[1]!,
    accountId: 'retained-new',
    amountCents: 23000,
  };
  const added = {
    ...data.A[0]!,
    id: 'INV-3',
    accountId: 'added',
    amountCents: 30000,
  };
  data.A = [added, retained];
  await assert.rejects(alias.invalidate('ledger'), /incomplete/);
  assert.deepEqual(
    full.getSnapshot().records?.map((r) => r.identity['id']),
    ['INV-1', 'INV-2'],
  );
  assert.deepEqual(
    full.getSnapshot().records?.map((r) => r.data['accountId']),
    ['A-ledger-1-v1', 'retained-new'],
  );
  assert.deepEqual(
    full.getSnapshot().records?.map((r) => r.data['amountCents']),
    [12500, 13000],
  );
  assert.equal(full.getSnapshot().membershipStale, true);
  assert.match(requests.at(-1)!.query, /ledger: accountId/);
  assert.doesNotMatch(requests.at(-1)!.query, /amountCents|status/);
  await full.refreshList();
  assert.deepEqual(
    full.getSnapshot().records?.map((r) => r.identity['id']),
    ['INV-3', 'INV-2'],
  );
  assert.deepEqual(
    full.getSnapshot().records?.map((r) => r.data['amountCents']),
    [30000, 23000],
  );
  assert.deepEqual(
    alias.getSnapshot().records?.map((r) => r.data['ledger']),
    ['added', 'retained-new'],
  );
  assert.equal(full.getSnapshot().membershipStale, false);
  assert.equal(full.stateAddress, stateAddress);
  assert.equal(other.getSnapshot(), otherBefore);
  assert.match(requests.at(-1)!.query, /amountCents/);
  assert.match(requests.at(-1)!.query, /status/);
});

test('a record leaving a filtered list keeps its old status stale until explicit membership reconciliation', async (t) => {
  const { client, data, requests } = fixture();
  t.after(() => client.dispose());
  const filtered = definition.bind(
    { ...args, 'billing.invoices': { status: 'OPEN' } },
    scope,
  );
  const handle = client.watch(filtered);
  await handle.ready;
  data.A[0]!.status = 'PAID';
  await assert.rejects(handle.invalidate('status'), /incomplete/);
  assert.equal(handle.getSnapshot().records?.[0]?.data['status'], 'OPEN');
  assert.equal(
    handle
      .getSnapshot()
      .records?.[0]?.fields.find((f) => f.path[0] === 'status')?.stale,
    true,
  );
  assert.equal(handle.getSnapshot().membershipStale, true);
  await handle.refreshList();
  assert.deepEqual(handle.getSnapshot().records, []);
  assert.equal(handle.getSnapshot().stale, false);
  assert.equal(handle.getSnapshot().error, undefined);
  assert.deepEqual(requests.at(-1)!.variables, filtered.prepare().variables);
});

test('real HTTP list refresh adopts server order while field refresh preserves cached order', async (t) => {
  const api = await listen(0);
  t.after(api.close);
  const client = createGraphQLClient({ endpoint: `${api.url}/graphql` });
  t.after(() => client.dispose());
  const handle = client.watch(definition.bind(args, scope));
  await handle.ready;
  api.fixture.reverse('A');
  api.fixture.advance('A');
  await handle.refresh('accountId');
  assert.deepEqual(
    handle.getSnapshot().records?.map((r) => r.identity['id']),
    ['INV-1', 'INV-2'],
  );
  assert.equal(handle.getSnapshot().membershipStale, false);
  await handle.refreshList();
  assert.deepEqual(
    handle.getSnapshot().records?.map((r) => r.identity['id']),
    ['INV-2', 'INV-1'],
  );
  assert.deepEqual(
    handle.getSnapshot().records?.map((r) => r.data['amountCents']),
    [14000, 13500],
  );
});

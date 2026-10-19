import { createGraphQLClient } from '../packages/graphql/src/index.js';
import { listen } from '../apps/billing-api/src/server.js';
import { schema } from '../examples/query-planner/src/generated/billing.js';

const api = await listen(0);
const client = createGraphQLClient({ endpoint: `${api.url}/graphql` });
try {
  const base = schema
    .field('billing')
    .field('invoices')
    .select({ accountId: true });
  const args = { billing: { tenantId: 'A' } };
  const scope = { source: 'billing-api', scope: 'demo' };
  const summary = client.watch(base.bind(args, scope));
  const duplicate = client.watch(base.bind(args, scope));
  await Promise.all([summary.ready, duplicate.ready]);
  const snapshot = summary.getSnapshot();
  console.log(
    'Automatically acquired account IDs:',
    snapshot.records?.map((record) => record.data['accountId']),
  );
  const detail = client.watch(
    base.extend({ amountCents: true }).bind(args, scope),
  );
  await detail.ready;
  console.log(
    'Extended view:',
    detail.getSnapshot().records?.map((record) => record.data),
  );
  console.log(
    'Summary snapshot unchanged:',
    summary.getSnapshot() === snapshot,
  );
  api.fixture.advance('A');
  const stateAddress = detail.stateAddress;
  await detail.invalidate('accountId');
  console.log('State address unchanged:', detail.stateAddress === stateAddress);
  console.log(
    'Shared refreshed account IDs:',
    duplicate.getSnapshot().records?.map((record) => record.data['accountId']),
  );
  console.log(
    'Detail retains cached amounts:',
    detail.getSnapshot().records?.map((record) => record.data),
  );
  api.fixture.reverse('A');
  await detail.refresh('accountId');
  console.log(
    'Field refresh retains cached order:',
    detail.getSnapshot().records?.map((record) => record.identity['id']),
  );
  await detail.refreshList();
  console.log(
    'List refresh adopts server order and current amounts:',
    detail.getSnapshot().records?.map((record) => ({
      id: record.identity['id'],
      ...record.data,
    })),
  );
  const response = await fetch(`${api.url}/__fixture/requests`);
  console.log('Fixture request evidence:', await response.json());
  summary.dispose();
  duplicate.dispose();
  detail.dispose();
} finally {
  client.dispose();
  await api.close();
}

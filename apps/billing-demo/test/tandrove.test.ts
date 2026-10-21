import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGraphQLClient } from '@tandrove/graphql';
import { listen, type RequestRecord } from '../../billing-api/src/server.js';
import {
  accountMonitor,
  billingInvoices,
  billingScope,
} from '../src/data/tandrove-definitions.js';

test('demo domain and derived feature share state, narrow requests and explicit list refresh', async (t) => {
  const api = await listen(0);
  const client = createGraphQLClient({
    endpoint: `${api.url}/graphql`,
    retry: false,
  });
  t.after(async () => {
    client.dispose();
    await api.close();
  });
  const domain = billingInvoices.bind(
    { billing: { tenantId: 'A' } },
    billingScope,
  );
  const feature = accountMonitor.bind(
    { billing: { tenantId: 'A' } },
    billingScope,
  );
  const workspace = client.watch(domain);
  const monitor = client.watch(feature);
  assert.equal(workspace.stateAddress, monitor.stateAddress);
  await Promise.all([workspace.ready, monitor.ready]);
  const requests = async () =>
    (await (await fetch(`${api.url}/__fixture/requests`)).json()) as {
      count: number;
      records: RequestRecord[];
    };
  assert.equal((await requests()).count, 1);
  assert.deepEqual(
    Object.keys(monitor.getSnapshot().records![0]!.data).sort(),
    ['accountId', 'status'],
  );
  const original = domain.prepare().query;
  api.fixture.advance('A');
  api.fixture.reverse('A');
  await workspace.invalidate('accountId');
  assert.equal(domain.prepare().query, original);
  assert.equal(workspace.stateAddress, monitor.stateAddress);
  assert.deepEqual(
    workspace
      .getSnapshot()
      .records?.map((row) => [
        row.identity['id'],
        row.data['accountId'],
        row.data['amountCents'],
      ]),
    [
      ['INV-1', 'A-ledger-1-v2', 12500],
      ['INV-2', 'A-ledger-2-v2', 13000],
    ],
  );
  assert.equal(
    monitor.getSnapshot().records![0]!.data['accountId'],
    'A-ledger-1-v2',
  );
  const log = await requests();
  assert.equal(log.count, 2);
  assert.deepEqual(
    log.records[1]!.fields.sort(),
    ['__typename', 'accountId', 'billing', 'id', 'invoices', 'tenantId'].sort(),
  );
  assert.ok(log.records[1]!.responseBytes < log.records[0]!.responseBytes);
  await workspace.refreshList();
  assert.deepEqual(
    monitor.getSnapshot().records?.map((row) => row.identity['id']),
    ['INV-2', 'INV-1'],
  );
  assert.equal(workspace.getSnapshot().records![1]!.data['amountCents'], 13500);
});

test('mounting the smaller feature first requests only missing workspace fields later', async (t) => {
  const api = await listen(0);
  const client = createGraphQLClient({
    endpoint: `${api.url}/graphql`,
    retry: false,
  });
  t.after(async () => {
    client.dispose();
    await api.close();
  });
  const args = { billing: { tenantId: 'B' } };
  const monitor = client.watch(accountMonitor.bind(args, billingScope));
  await monitor.ready;
  const workspace = client.watch(billingInvoices.bind(args, billingScope));
  await workspace.ready;
  const log = (await (await fetch(`${api.url}/__fixture/requests`)).json()) as {
    records: RequestRecord[];
  };
  assert.equal(log.records.length, 2);
  assert.ok(log.records[1]!.fields.includes('amountCents'));
  assert.ok(log.records[1]!.fields.includes('name'));
  assert.equal(log.records[1]!.fields.includes('accountId'), false);
  assert.equal(log.records[1]!.fields.includes('status'), false);
  monitor.dispose();
  api.fixture.advance('B');
  await workspace.invalidate('accountId');
  assert.equal(
    workspace.getSnapshot().records![0]!.data['accountId'],
    'B-ledger-1-v2',
  );
});

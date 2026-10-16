import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ApolloClient, HttpLink } from '@apollo/client/core';
import { validate } from 'graphql';
import { listen, type RequestRecord } from '../../billing-api/src/server.js';
import { schema } from '../../billing-api/src/schema.js';
import { createBillingCache } from '../src/data/cache.js';
import {
  BILLING_INVOICES,
  INVOICE_ACCOUNTS,
  SAVE_INVOICE,
  type BillingResult,
  type TenantId,
} from '../src/data/operations.js';

async function setup(t: TestContext) {
  const api = await listen(0);
  const client = new ApolloClient({
    cache: createBillingCache(),
    link: new HttpLink({ uri: `${api.url}/graphql` }),
  });
  t.after(async () => {
    client.stop();
    await api.close();
  });
  const requests = async () =>
    (await (await fetch(`${api.url}/__fixture/requests`)).json()) as {
      count: number;
      records: RequestRecord[];
    };
  return { ...api, client, requests };
}

async function until(
  predicate: () => boolean | Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!(await predicate())) {
    if (Date.now() > deadline)
      assert.fail('Timed out waiting for observable behavior.');
    await delay(5);
  }
}

function watch(client: ApolloClient, tenantId: TenantId) {
  const values: BillingResult[] = [];
  const query = client.watchQuery({
    query: BILLING_INVOICES,
    variables: { tenantId },
  });
  const subscription = query.subscribe((result) => {
    if (result.dataState === 'complete' && result.data)
      values.push(result.data);
  });
  return {
    query,
    subscription,
    values,
    latest: () => values.at(-1)?.billing.invoices,
  };
}

test('baseline documents validate against the same schema used by the fixture', () => {
  for (const document of [BILLING_INVOICES, INVOICE_ACCOUNTS, SAVE_INVOICE])
    assert.deepEqual(validate(schema, document), []);
});

test('two watchers share one read; narrow request merges account IDs while preserving siblings', async (t) => {
  const { client, fixture, requests } = await setup(t);
  const first = watch(client, 'A');
  const second = watch(client, 'A');
  t.after(() => {
    first.subscription.unsubscribe();
    second.subscription.unsubscribe();
  });
  await until(() => first.values.length > 0 && second.values.length > 0);
  assert.equal((await requests()).count, 1);
  fixture.advance('A');
  await client.query({
    query: INVOICE_ACCOUNTS,
    variables: { tenantId: 'A' },
    fetchPolicy: 'network-only',
  });
  await until(() => second.latest()?.[0]?.accountId === 'A-ledger-1-v2');
  for (const consumer of [first, second]) {
    assert.equal(consumer.latest()?.[0]?.accountId, 'A-ledger-1-v2');
    assert.equal(consumer.latest()?.[0]?.amountCents, 12500);
    assert.equal(consumer.latest()?.[0]?.user.name, 'Ada 1');
  }
  const log = await requests();
  assert.equal(log.count, 2);
  const narrow = log.records[1];
  assert.ok(narrow?.fields.includes('accountId'));
  assert.equal(narrow?.fields.includes('amountCents'), false);
  assert.equal(narrow?.fields.includes('user'), false);
  assert.deepEqual(narrow?.variables, { tenantId: 'A' });
  assert.ok(narrow!.responseBytes < log.records[0]!.responseBytes);
  await first.query.refetch();
  await until(() => second.latest()?.[0]?.amountCents === 13500);
  assert.equal(second.latest()?.[0]?.user.name, 'Ada 1 v2');
});

test('reordered narrow results merge by composite identity and keep tenant data separate', async (t) => {
  const { client, fixture } = await setup(t);
  await client.query({ query: BILLING_INVOICES, variables: { tenantId: 'A' } });
  await client.query({ query: BILLING_INVOICES, variables: { tenantId: 'B' } });
  fixture.advance('A');
  fixture.reverse('A');
  await client.query({
    query: INVOICE_ACCOUNTS,
    variables: { tenantId: 'A' },
    fetchPolicy: 'network-only',
  });
  const a = client.readQuery({
    query: BILLING_INVOICES,
    variables: { tenantId: 'A' },
  });
  const b = client.readQuery({
    query: BILLING_INVOICES,
    variables: { tenantId: 'B' },
  });
  assert.deepEqual(
    a?.billing.invoices.map((item) => [
      item.id,
      item.accountId,
      item.amountCents,
    ]),
    [
      ['INV-2', 'A-ledger-2-v2', 13000],
      ['INV-1', 'A-ledger-1-v2', 12500],
    ],
  );
  assert.equal(b?.billing.invoices[0]?.accountId, 'B-ledger-1-v1');
  assert.equal(b?.billing.invoices[0]?.amountCents, 45500);
});

test('failed narrow request retains cached values and a later refresh recovers', async (t) => {
  const { client, fixture } = await setup(t);
  await client.query({ query: BILLING_INVOICES, variables: { tenantId: 'A' } });
  fixture.advance('A');
  fixture.configure({ latencyMs: 0, failNext: 'request' });
  const refresh = () =>
    client.query({
      query: INVOICE_ACCOUNTS,
      variables: { tenantId: 'A' },
      fetchPolicy: 'network-only',
    });
  await assert.rejects(refresh());
  assert.equal(
    client.readQuery({ query: BILLING_INVOICES, variables: { tenantId: 'A' } })
      ?.billing.invoices[0]?.accountId,
    'A-ledger-1-v1',
  );
  await refresh();
  assert.equal(
    client.readQuery({ query: BILLING_INVOICES, variables: { tenantId: 'A' } })
      ?.billing.invoices[0]?.accountId,
    'A-ledger-1-v2',
  );
});

test('save acknowledgement followed by narrow refresh updates existing watchers', async (t) => {
  const { client } = await setup(t);
  const consumer = watch(client, 'A');
  t.after(() => consumer.subscription.unsubscribe());
  await until(() => consumer.values.length > 0);
  await client.mutate({
    mutation: SAVE_INVOICE,
    variables: { tenantId: 'A', id: 'INV-1', accountId: 'saved-ledger' },
  });
  assert.equal(consumer.latest()?.[0]?.accountId, 'A-ledger-1-v1');
  await client.query({
    query: INVOICE_ACCOUNTS,
    variables: { tenantId: 'A' },
    fetchPolicy: 'network-only',
  });
  await until(() => consumer.latest()?.[0]?.accountId === 'saved-ledger');
  assert.equal(consumer.latest()?.[0]?.amountCents, 12500);
});

test('late response for A cannot replace the current B view; unsubscribing one watcher leaves another alive', async (t) => {
  const { client, fixture, requests } = await setup(t);
  const moving = watch(client, 'A');
  const staying = watch(client, 'A');
  t.after(() => {
    moving.subscription.unsubscribe();
    staying.subscription.unsubscribe();
  });
  await until(() => moving.values.length > 0 && staying.values.length > 0);
  fixture.advance('A');
  fixture.configure({ latencyMs: 150, failNext: 'none' });
  const pending = client.query({
    query: INVOICE_ACCOUNTS,
    variables: { tenantId: 'A' },
    fetchPolicy: 'network-only',
  });
  await until(async () => (await requests()).count === 2);
  fixture.configure({ latencyMs: 0, failNext: 'none' });
  await moving.query.setVariables({ tenantId: 'B' });
  await pending;
  await until(() => staying.latest()?.[0]?.accountId === 'A-ledger-1-v2');
  assert.equal(moving.values.at(-1)?.billing.tenantId, 'B');
  assert.equal(moving.latest()?.[0]?.accountId, 'B-ledger-1-v1');
  moving.subscription.unsubscribe();
  fixture.advance('A');
  await staying.query.refetch();
  await until(() => staying.latest()?.[0]?.accountId === 'A-ledger-1-v3');
});

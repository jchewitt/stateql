import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listen } from '../src/server.js';

const query = `query Billing($tenantId: ID!) { billing(tenantId: $tenantId) { tenantId invoices { id accountId amountCents user { name } } } }`;

test('fixture removal is scoped and rejected saves carry an explicit pre-write code', async (t) => {
  const api = await listen(0);
  t.after(api.close);
  const post = (path: string, body: unknown) =>
    fetch(api.url + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await post('/__fixture/control', {
        action: 'remove',
        tenantId: 'A',
        id: 'INV-1',
      })
    ).status,
    200,
  );
  assert.equal(api.fixture.snapshot().A.length, 1);
  assert.equal(api.fixture.snapshot().B.length, 2);
  assert.equal(
    (
      await post('/__fixture/control', {
        action: 'remove',
        tenantId: 'A',
        id: 123,
      })
    ).status,
    400,
  );
  const result = (await (
    await post('/graphql', {
      query:
        'mutation { saveInvoice(tenantId: "A", id: "INV-1", accountId: "new") { id } }',
    })
  ).json()) as { errors: { extensions: { code: string } }[] };
  assert.equal(result.errors[0]?.extensions.code, 'FIXTURE_SAVE_REJECTED');
  assert.equal(api.fixture.snapshot().A.length, 1);
});

test('HTTP fixture scopes invoices, logs requests, supports save and reset', async (t) => {
  const api = await listen(0);
  t.after(api.close);
  const call = async (query: string, variables: Record<string, unknown>) => {
    const response = await fetch(`${api.url}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    return response.json() as Promise<{
      data: {
        billing: {
          tenantId: string;
          invoices: {
            id: string;
            accountId: string | null;
            amountCents: number;
          }[];
        };
        saveInvoice: { accountId: string | null };
      };
      errors?: { message: string; path: (string | number)[] }[];
    }>;
  };
  const first = await call(query, { tenantId: 'A' });
  const second = await call(query, { tenantId: 'B' });
  assert.equal(
    first.data.billing.invoices[0]?.id,
    second.data.billing.invoices[0]?.id,
  );
  assert.notEqual(
    first.data.billing.invoices[0]?.accountId,
    second.data.billing.invoices[0]?.accountId,
  );
  const mutation = `mutation { saveInvoice(tenantId: "A", id: "INV-1", accountId: null) { accountId } }`;
  assert.equal((await call(mutation, {})).data.saveInvoice.accountId, null);
  assert.equal(
    (await call(query, { tenantId: 'A' })).data.billing.invoices[0]?.accountId,
    null,
  );
  api.fixture.reset();
  assert.equal(
    (await call(query, { tenantId: 'A' })).data.billing.invoices[0]?.accountId,
    'A-ledger-1-v1',
  );
  const log = (await (await fetch(`${api.url}/__fixture/requests`)).json()) as {
    count: number;
    records: { fields: string[]; responseBytes: number }[];
  };
  assert.equal(log.count, 5);
  assert.ok(log.records[0]?.fields.includes('accountId'));
  assert.ok((log.records[0]?.responseBytes ?? 0) > 0);
});

test('request failures are consumed once; field failures have paths and partial data', async (t) => {
  const api = await listen(0);
  t.after(api.close);
  const request = () =>
    fetch(`${api.url}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { tenantId: 'A' } }),
    });
  api.fixture.configure({ latencyMs: 0, failNext: 'request' });
  assert.equal((await request()).status, 503);
  assert.equal((await request()).status, 200);
  api.fixture.configure({ latencyMs: 0, failNext: 'accountId' });
  const partial = (await (await request()).json()) as {
    data: {
      billing: {
        invoices: { accountId: string | null; amountCents: number }[];
      };
    };
    errors: { path: (string | number)[] }[];
  };
  assert.equal(partial.data.billing.invoices[0]?.accountId, null);
  assert.equal(partial.data.billing.invoices[0]?.amountCents, 12500);
  assert.deepEqual(partial.errors[0]?.path, [
    'billing',
    'invoices',
    0,
    'accountId',
  ]);
});

test('HTTP validation rejects malformed input and fixture controls without JSON', async (t) => {
  const api = await listen(0);
  t.after(api.close);
  for (const body of [
    '{',
    '[]',
    JSON.stringify({ query: '{ unknown }' }),
    JSON.stringify({ query, variables: [] }),
  ]) {
    const response = await fetch(`${api.url}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    assert.equal(response.status, 400);
  }
  assert.equal(
    (
      await fetch(`${api.url}/__fixture/control`, {
        method: 'POST',
        body: 'action=reset',
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await fetch(`${api.url}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: ' '.repeat(70 * 1024) }),
      })
    ).status,
    413,
  );
  const response = await fetch(`${api.url}/__fixture/control`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'configure',
      latencyMs: -1,
      failNext: 'none',
    }),
  });
  assert.equal(response.status, 400);
});

test('status filter and unknown tenant are validated by the schema and fixture', async (t) => {
  const api = await listen(0);
  t.after(api.close);
  const response = await fetch(`${api.url}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: '{ billing(tenantId: "A") { invoices(status: OPEN) { id } } }',
    }),
  });
  assert.deepEqual(await response.json(), {
    data: { billing: { invoices: [{ id: 'INV-1' }] } },
  });
  const invalid = await fetch(`${api.url}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { tenantId: 'unknown' } }),
  });
  const result = (await invalid.json()) as { data: unknown; errors: unknown[] };
  assert.equal(result.data, null);
  assert.equal(result.errors.length, 1);
});

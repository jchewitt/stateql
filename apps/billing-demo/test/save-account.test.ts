import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SaveError } from '../src/forms/draft.js';
import { saveAccount } from '../src/forms/save-account.js';

test('command transport validates scoped acknowledgements and never retries ambiguous responses', async (t) => {
  const target = { tenantId: 'A' as const, id: 'INV-1' };
  let calls = 0;
  let body = JSON.stringify({ data: { saveInvoice: target } });
  let status = 200;
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: unknown, options: RequestInit) => {
      calls++;
      const request = JSON.parse(String(options.body)) as {
        variables: unknown;
        operationName: string;
      };
      assert.equal(request.operationName, 'SaveInvoice');
      assert.deepEqual(request.variables, { ...target, accountId: null });
      return new Response(body, { status });
    },
  );
  await saveAccount(target, null);
  assert.equal(calls, 1);
  for (const candidate of [
    { body: '{broken', status: 200, outcome: 'unknown' },
    {
      body: JSON.stringify({
        data: { saveInvoice: { tenantId: 'B', id: 'INV-1' } },
      }),
      status: 200,
      outcome: 'unknown',
    },
    {
      body: JSON.stringify({ data: { saveInvoice: target } }),
      status: 500,
      outcome: 'unknown',
    },
    {
      body: JSON.stringify({ errors: [{ message: 'Generic failure' }] }),
      status: 200,
      outcome: 'unknown',
    },
    {
      body: JSON.stringify({
        errors: [{ extensions: { code: 'FIXTURE_SAVE_REJECTED' } }],
      }),
      status: 200,
      outcome: 'rejected',
    },
  ]) {
    body = candidate.body;
    status = candidate.status;
    const before: number = calls;
    await assert.rejects(
      saveAccount(target, null),
      (error: unknown) =>
        error instanceof SaveError && error.outcome === candidate.outcome,
    );
    assert.equal(calls, before + 1);
  }
});

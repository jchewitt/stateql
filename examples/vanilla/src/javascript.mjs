import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createSchema, createGraphQLClient } from '@jchewitt/stateql-graphql';
import { createFixture, sdl, identities } from './fixture.mjs';

/** Native JavaScript: no generated model, transpiler or TypeScript loader. */
export async function runJavaScriptExample(log = console.log) {
  const fixture = createFixture();
  const schema = createSchema(sdl, { identities });
  const base = schema
    .field('billing')
    .field('invoices')
    .select({
      accountId: { as: 'ledger' },
      user: { select: { name: { args: { locale: 'en' } } } },
    });
  const args = { billing: { tenantId: 'A' } };
  const scope = { source: 'fixture', scope: 'session-A' };
  const client = createGraphQLClient({ transport: fixture.transport });
  try {
    const a = client.watch(base.bind(args, scope));
    const b = client.watch(
      base.select({ accountId: { as: 'ledger' } }).bind(args, scope),
    );
    await Promise.all([a.ready, b.ready]);
    assert.equal(fixture.requests.length, 1);
    const extended = client.watch(
      base.extend({ amount: true }).bind(args, scope),
    );
    await extended.ready;
    assert.equal(fixture.requests.length, 2);
    assert.ok(fixture.requests[1]);
    assert.doesNotMatch(fixture.requests[1].query, /accountId/);
    fixture.advance();
    await b.invalidate('ledger');
    assert.equal(a.getSnapshot().records?.[0]?.data['ledger'], 'A-account-v2');
    assert.equal(extended.getSnapshot().records?.[0]?.data['amount'], 10);
    assert.ok(fixture.requests[2]);
    assert.doesNotMatch(fixture.requests[2].query, /amount/);
    await a.refresh('user.name');
    assert.equal(
      JSON.stringify(a.getSnapshot().records?.[0]?.data['user']),
      JSON.stringify({ name: 'en-user-v2' }),
    );
    assert.equal(a.stateAddress, b.stateAddress);
    // Dynamic names pass editor checking; SDL-dependent mistakes still reject at runtime.
    assert.throws(() => schema.field('missing'));
    assert.throws(() => base.extend({ missing: true }));
    assert.throws(() => base.bind({ billing: { unknown: 'A' } }, scope));
    await assert.rejects(b.invalidate('missing'));
    assert.equal(fixture.requests.length, 4);
    log(
      'Plain JavaScript: 4 requests; shared state, narrow alias refresh, cached amount preserved.',
    );
    for (const operation of fixture.requests) log(operation.query);
    return {
      requests: fixture.requests.length,
      cachedAmount: extended.getSnapshot().records?.[0]?.data['amount'],
    };
  } finally {
    client.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runJavaScriptExample();

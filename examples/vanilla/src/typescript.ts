import assert from 'node:assert/strict';
import {
  createSchema,
  createGraphQLClient,
  type FieldType,
  type ObjectRef,
  type ResultOf,
} from '@launch-echo/stateql-graphql';
import { createFixture, sdl, identities } from './fixture.mjs';

// A generated schema can supply this model in a real app. Types add editor checks;
// the runtime definitions and behavior are the same as the JavaScript example.
type Model = {
  Query: { billing: FieldType<ObjectRef<'Billing'>, { tenantId: string }> };
  Billing: {
    tenantId: FieldType<string>;
    invoices: FieldType<readonly ObjectRef<'Invoice'>[]>;
  };
  Invoice: {
    id: FieldType<string>;
    accountId: FieldType<string>;
    amount: FieldType<number>;
  };
};
const schema = createSchema<Model>(sdl, { identities });
const definition = schema
  .field('billing')
  .field('invoices')
  .select({ accountId: true, amount: true });
type Invoice = ResultOf<typeof definition>;
const sample: Invoice = { accountId: 'account', amount: 10 };
assert.equal(sample.amount, 10);
const fixture = createFixture();
const client = createGraphQLClient({ transport: fixture.transport });
try {
  const handle = client.watch(
    definition.bind(
      { billing: { tenantId: 'A' } },
      { source: 'fixture', scope: 'session-A' },
    ),
  );
  await handle.ready;
  fixture.advance();
  await handle.invalidate('accountId');
  assert.equal(
    handle.getSnapshot().records?.[0]?.data['accountId'],
    'A-account-v2',
  );
  assert.equal(handle.getSnapshot().records?.[0]?.data['amount'], 10);
  console.log(
    'Vanilla TypeScript: typed definition, 2 requests, cached amount preserved.',
  );
} finally {
  client.dispose();
}

// Compile-only checks: the runtime-SDL overload must not weaken explicit models.
if (false) {
  // @ts-expect-error field is absent from the explicit model
  schema.field('missing');
  // @ts-expect-error unknown selected field
  definition.extend({ missing: true });
  // @ts-expect-error required tenant argument is missing
  definition.bind({}, { source: 'fixture', scope: 'A' });
}

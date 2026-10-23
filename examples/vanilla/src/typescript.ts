import assert from 'node:assert/strict';
import {
  createSchema,
  createGraphQLClient,
  type FieldType,
  type ObjectRef,
  type ResultOf,
} from '@tandrove/graphql';
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
  const data = handle.getSnapshot().records?.[0]?.data;
  // Inferred scalar types still include missing coverage, even after ready settles.
  const accountId: string | undefined = data?.accountId;
  const amount: number | undefined = data?.amount;
  assert.equal(accountId, 'A-account-v2');
  assert.equal(amount?.toFixed(2), '10.00');
  if (false) {
    // @ts-expect-error Injected record identity is not an implicitly selected data field.
    data?.id;
    // @ts-expect-error A completed read does not prove every selected value is present.
    const required: number = data!.amount;
    void required;
  }
  console.log(
    'Vanilla TypeScript: inferred partial snapshots, 2 requests, cached amount preserved.',
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

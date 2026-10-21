import assert from 'node:assert/strict';
import { ApolloClient, ApolloLink, Observable } from '@apollo/client/core';
import { execute, print, type DocumentNode } from 'graphql';
import { createGraphQLClient } from '@launch-echo/stateql-graphql';
import { BillingFixture } from '../../billing-api/src/fixture.js';
import { schema, createRoot } from '../../billing-api/src/schema.js';
import { createBillingCache } from '../src/data/cache.js';
import { BILLING_INVOICES, INVOICE_ACCOUNTS } from '../src/data/operations.js';
import {
  billingInvoices,
  billingScope,
} from '../src/data/stateql-definitions.js';

/** Observe actual client-emitted operations, with no HTTP or artificial delay. */
export async function compareNetwork() {
  const measurements = [];
  for (const mode of ['apollo', 'stateql'] as const) {
    const fixture = new BillingFixture();
    const operations: {
      query: string;
      variables: unknown;
      responseBytes: number;
    }[] = [];
    const run = (
      document: DocumentNode,
      variables: Record<string, unknown>,
    ) => {
      const result = execute({
        schema,
        document,
        variableValues: variables,
        rootValue: createRoot(fixture, fixture.snapshot(), false),
      });
      assert.ok(!('then' in result), 'Fixture execution must be synchronous.');
      assert.equal(result.errors, undefined);
      assert.ok(result.data);
      operations.push({
        query: print(document),
        variables,
        responseBytes: Buffer.byteLength(JSON.stringify(result)),
      });
      return { data: result.data };
    };
    if (mode === 'apollo') {
      const client = new ApolloClient({
        cache: createBillingCache(),
        link: new ApolloLink(
          (operation) =>
            new Observable((observer) => {
              observer.next(run(operation.query, operation.variables));
              observer.complete();
            }),
        ),
      });
      try {
        await client.query({
          query: BILLING_INVOICES,
          variables: { tenantId: 'A' },
        });
        fixture.advance('A');
        await client.query({
          query: INVOICE_ACCOUNTS,
          variables: { tenantId: 'A' },
          fetchPolicy: 'network-only',
        });
        const data = client.readQuery({
          query: BILLING_INVOICES,
          variables: { tenantId: 'A' },
        });
        assert.equal(data?.billing.invoices[0]?.accountId, 'A-ledger-1-v2');
        assert.equal(data?.billing.invoices[0]?.amountCents, 12500);
        assert.equal(data?.billing.invoices[0]?.user.name, 'Ada 1');
      } finally {
        client.stop();
      }
    } else {
      const client = createGraphQLClient({
        transport: async (operation) =>
          run(operation.document, operation.variables),
        retry: false,
      });
      try {
        const handle = client.watch(
          billingInvoices.bind({ billing: { tenantId: 'A' } }, billingScope),
        );
        await handle.ready;
        fixture.advance('A');
        await handle.invalidate('accountId');
        const data = handle.getSnapshot().records?.[0]?.data;
        assert.equal(data?.['accountId'], 'A-ledger-1-v2');
        assert.equal(data?.['amountCents'], 12500);
        const user = data?.['user'];
        assert.ok(user && typeof user === 'object' && 'name' in user);
        assert.equal(user['name'], 'Ada 1');
        handle.dispose();
      } finally {
        client.dispose();
      }
    }
    assert.equal(operations.length, 2);
    assert.ok(!operations[1]!.query.includes('amountCents'));
    measurements.push({ mode, operations });
  }
  assert.deepEqual(
    measurements[0]!.operations.map((x) => x.responseBytes),
    measurements[1]!.operations.map((x) => x.responseBytes),
  );
  return measurements;
}

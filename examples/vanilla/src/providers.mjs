import assert from 'node:assert/strict';
import {
  AcquisitionClient,
  createAcquisitionSourceToken,
  createProviderScope,
  provide,
} from '@tandrove/core';
import {
  createGraphQLClient,
  createGraphQLTransportToken,
  createSchema,
} from '@tandrove/graphql';
import { createFixture, identities, sdl } from './fixture.mjs';
import { createWholeResourceFixture } from './fake-adapters.mjs';

const fixture = createFixture();
const applicationSource = createWholeResourceFixture('custom');
const transportToken = createGraphQLTransportToken('application GraphQL');
const sourceToken = createAcquisitionSourceToken('application source');
let initialized = 0,
  privateCleanup = 0;
const providers = createProviderScope([
  provide(transportToken, {
    useFactory: async ({ onCleanup }) => {
      initialized++;
      onCleanup(() => {
        privateCleanup++;
      });
      return fixture.transport;
    },
  }),
  provide(sourceToken, { useValue: applicationSource.source }),
]);
const native = new AcquisitionClient();
/** @type {import('@tandrove/graphql').GraphQLClient | undefined} */
let graphql;
try {
  const [transport, same] = await Promise.all([
    providers.resolve(transportToken),
    providers.resolve(transportToken),
  ]);
  assert.equal(transport, same);
  graphql = createGraphQLClient({ transport });
  const bound = createSchema(sdl, { identities })
    .field('billing')
    .field('invoices')
    .select({ accountId: true })
    .bind(
      { billing: { tenantId: 'A' } },
      { source: 'example', scope: 'session' },
    );
  const a = graphql.watch(bound),
    b = graphql.watch(bound);
  const custom = native.watch(providers.get(sourceToken));
  await Promise.all([a.ready, b.ready, custom.ready]);
  assert.equal(initialized, 1);
  assert.equal(fixture.requests.length, 1);
  a.dispose();
  fixture.advance();
  await b.invalidate('accountId');
  assert.equal(b.getSnapshot().records?.[0]?.data['accountId'], 'A-account-v2');
  assert.equal(
    custom.getSnapshot().records?.[0]?.data['accountId'],
    'custom-account-v1',
  );
  assert.equal(privateCleanup, 0);
} finally {
  graphql?.dispose();
  native.dispose();
  await providers.dispose();
}
assert.equal(privateCleanup, 1);
console.log(
  'Providers: shared initialization, ordinary GraphQL/custom acquisition, and explicit runtime cleanup passed.',
);

import {
  createProviderScope,
  createProviderToken,
  provide,
} from '@tandrove/core';
import {
  createGraphQLClient,
  createGraphQLTransportToken,
  type GraphQLResourceOptions,
} from '../src/index.js';
const token = createGraphQLTransportToken();
const scope = createProviderScope([
  provide(token, { useValue: async () => ({ data: {} }) }),
]);
createGraphQLClient({
  providerScope: scope,
  providers: { transport: token },
  resourceGroups: { offline: { providers: { transport: false } } },
});
const options: GraphQLResourceOptions = {
  group: 'offline',
  providers: { transport: token },
};
void options;
const wrong = createProviderToken(
  'number',
  (value): value is number => typeof value === 'number',
);
// @ts-expect-error Transport assignment must use a transport token.
createGraphQLClient({ providerScope: scope, providers: { transport: wrong } });
createGraphQLClient({
  providerScope: scope,
  // @ts-expect-error GraphQL exposes transport, not a competing acquisition override.
  providers: { acquisition: token },
});

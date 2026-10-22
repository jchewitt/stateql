import { createProviderToken } from '@tandrove/core';
import type { GraphQLTransport } from './client.js';

/** Register official HTTP or application transports using the same capability. */
export function createGraphQLTransportToken(description = 'GraphQL transport') {
  return createProviderToken<GraphQLTransport>(
    description,
    (value): value is GraphQLTransport => typeof value === 'function',
  );
}

import { createGraphQLClient } from '@tandrove/graphql';
export {
  billingInvoices,
  billingScope,
} from '../../src/data/tandrove-definitions.js';

export function createClient(endpoint: string) {
  return createGraphQLClient({ endpoint, retry: false });
}

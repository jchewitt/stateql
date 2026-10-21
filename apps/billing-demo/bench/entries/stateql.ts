import { createGraphQLClient } from '@launch-echo/stateql-graphql';
export {
  billingInvoices,
  billingScope,
} from '../../src/data/stateql-definitions.js';

export function createClient(endpoint: string) {
  return createGraphQLClient({ endpoint, retry: false });
}

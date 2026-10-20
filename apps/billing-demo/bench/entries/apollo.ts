import { ApolloClient, HttpLink } from '@apollo/client/core';
import { createBillingCache } from '../../src/data/cache.js';
export {
  BILLING_INVOICES,
  INVOICE_ACCOUNTS,
} from '../../src/data/operations.js';

export function createClient(endpoint: string) {
  return new ApolloClient({
    cache: createBillingCache(),
    link: new HttpLink({ uri: endpoint }),
  });
}

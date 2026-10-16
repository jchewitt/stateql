import { InMemoryCache } from '@apollo/client/core';

/** The fixture IDs are unique inside a tenant, not across tenants. */
export function createBillingCache(): InMemoryCache {
  return new InMemoryCache({
    typePolicies: {
      Billing: { keyFields: ['tenantId'] },
      Invoice: { keyFields: ['tenantId', 'id'] },
      User: { keyFields: ['tenantId', 'id'] },
    },
  });
}

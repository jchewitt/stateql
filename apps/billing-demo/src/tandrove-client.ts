import { InjectionToken } from '@angular/core';
import { provideTandroveClient } from '@tandrove/angular';
import { createGraphQLClient, type GraphQLClient } from '@tandrove/graphql';

export const BILLING_CLIENT = new InjectionToken<GraphQLClient>(
  'Billing Tandrove',
);

export function provideBillingClient(endpoint: string) {
  return provideTandroveClient(BILLING_CLIENT, () =>
    createGraphQLClient({
      endpoint,
      // Match the Apollo baseline: failed reads remain visible until manual retry.
      retry: false,
    }),
  );
}

import { InjectionToken } from '@angular/core';
import { provideStateQLClient } from '@launch-echo/stateql-angular';
import {
  createGraphQLClient,
  type GraphQLClient,
} from '@launch-echo/stateql-graphql';

export const BILLING_CLIENT = new InjectionToken<GraphQLClient>(
  'Billing StateQL',
);

export function provideBillingClient(endpoint: string) {
  return provideStateQLClient(BILLING_CLIENT, () =>
    createGraphQLClient({
      endpoint,
      // Match the Apollo baseline: failed reads remain visible until manual retry.
      retry: false,
    }),
  );
}

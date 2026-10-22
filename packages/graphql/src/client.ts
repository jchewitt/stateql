import {
  AcquisitionClient,
  type QueryHandle,
  type AcquisitionSource,
  type AcquisitionClientOptions,
  type ResourceRequestOptions,
} from '@tandrove/core';
import type { PreparedOperation } from './operation.js';
import type { FieldPaths } from './types.js';
import { httpTransport } from './http-transport.js';
import { defaultRetryScheduler } from './retry-scheduler.js';
export { httpTransport } from './http-transport.js';

export type GraphQLTransport = (
  operation: PreparedOperation,
  context?: GraphQLTransportContext,
) => Promise<unknown>;
export interface GraphQLTransportContext {
  readonly signal: AbortSignal;
}
export interface GraphQLClient {
  watch<R>(
    definition: {
      readonly resultType?: R;
      asSource(transport: GraphQLTransport): AcquisitionSource;
    },
    options?: ResourceRequestOptions,
  ): QueryHandle<FieldPaths<R>>;
  dispose(): void;
}
export function createGraphQLClient(
  options: AcquisitionClientOptions &
    (
      | {
          readonly endpoint: string;
          readonly headers?: () => Readonly<Record<string, string>>;
          readonly transport?: never;
        }
      | {
          readonly transport: GraphQLTransport;
          readonly endpoint?: never;
          readonly headers?: never;
        }
    ),
): GraphQLClient {
  const client = new AcquisitionClient({
    ...options,
    retry: options.retry ?? {},
    scheduler: options.scheduler ?? defaultRetryScheduler,
    deadlineScheduler:
      options.deadlineScheduler ?? options.scheduler ?? defaultRetryScheduler,
    freshnessScheduler: options.freshnessScheduler ?? defaultRetryScheduler,
    retentionScheduler:
      options.retentionScheduler ??
      options.freshnessScheduler ??
      defaultRetryScheduler,
  });
  const transport =
    options.transport ??
    httpTransport({
      endpoint: options.endpoint!,
      ...(options.headers === undefined ? {} : { headers: options.headers }),
    });
  return Object.freeze({
    watch: (
      definition: {
        asSource(transport: GraphQLTransport): AcquisitionSource;
      },
      binding?: ResourceRequestOptions,
    ) => client.watch(definition.asSource(transport), binding),
    dispose: () => client.dispose(),
  });
}

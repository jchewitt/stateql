import {
  AcquisitionClient,
  type QueryHandle,
  type AcquisitionSource,
  type AcquisitionClientOptions,
} from '@launch-echo/stateql-core';
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
  watch<R>(definition: {
    readonly resultType?: R;
    asSource(transport: GraphQLTransport): AcquisitionSource;
  }): QueryHandle<FieldPaths<R>>;
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
  });
  const transport =
    options.transport ??
    httpTransport({
      endpoint: options.endpoint!,
      ...(options.headers === undefined ? {} : { headers: options.headers }),
    });
  return Object.freeze({
    watch: (definition: {
      asSource(transport: GraphQLTransport): AcquisitionSource;
    }) => client.watch(definition.asSource(transport)),
    dispose: () => client.dispose(),
  });
}

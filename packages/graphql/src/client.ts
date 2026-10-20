import {
  AcquisitionClient,
  type QueryHandle,
  type AcquisitionSource,
} from '@jchewitt/stateql-core';
import type { PreparedOperation } from './operation.js';
import type { FieldPaths } from './types.js';

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
/** Default HTTP setup; headers may be supplied per request for current credentials. */
export function httpTransport(options: {
  readonly endpoint: string;
  readonly headers?: () => Readonly<Record<string, string>>;
}): GraphQLTransport {
  const url = new URL(options.endpoint);
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Expected an HTTP(S) endpoint.');
  return async (operation, context) => {
    const response = await fetch(url, {
      method: 'POST',
      ...(context === undefined ? {} : { signal: context.signal }),
      headers: { 'content-type': 'application/json', ...options.headers?.() },
      body: JSON.stringify({
        query: operation.query,
        variables: operation.variables,
      }),
    });
    if (!response.ok)
      throw new Error(`GraphQL HTTP request failed (${response.status}).`);
    return response.json() as Promise<unknown>;
  };
}
export function createGraphQLClient(
  options: { readonly onListenerError?: (error: unknown) => void } & (
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
  const client = new AcquisitionClient(options);
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

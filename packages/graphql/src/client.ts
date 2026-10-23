import {
  AcquisitionClient,
  type QueryHandle,
  type AcquisitionSource,
  type AcquisitionClientOptions,
  ResourceConfiguration,
  type ResourceConfigurationOptions,
  type ResourceOptions,
  type InputObject,
  type SnapshotData,
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
export interface GraphQLCapabilities {
  readonly transport: GraphQLTransport;
}
export type GraphQLResourceOptions = ResourceOptions<GraphQLCapabilities>;
export type GraphQLClientOptions = Omit<
  AcquisitionClientOptions,
  'providers' | 'providerScope' | 'resourceGroups'
> &
  ResourceConfigurationOptions<GraphQLCapabilities> &
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
    | {
        readonly endpoint?: never;
        readonly transport?: never;
        readonly headers?: never;
      }
  );
interface QueryDefinition {
  readonly resultType?: unknown;
  asSource(transport: GraphQLTransport): AcquisitionSource;
}
type DefinitionResult<Definition> = Definition extends {
  readonly resultType?: infer Result;
}
  ? Result
  : InputObject;
type DefinitionHandle<Definition> = QueryHandle<
  FieldPaths<SnapshotData<DefinitionResult<Definition>>>,
  DefinitionResult<Definition>
>;
export interface GraphQLClient {
  watch<Definition extends QueryDefinition>(
    definition: Definition,
    options?: GraphQLResourceOptions,
  ): DefinitionHandle<Definition>;
  dispose(): void;
}
export function createGraphQLClient(
  options: GraphQLClientOptions,
): GraphQLClient {
  const configuration = new ResourceConfiguration<GraphQLCapabilities>(
    options,
    {
      transport: (value): value is GraphQLTransport =>
        typeof value === 'function',
    },
  );
  if (
    options.transport !== undefined &&
    typeof options.transport !== 'function'
  )
    throw new Error('GraphQL transport must be a function.');
  if (options.transport !== undefined && options.endpoint !== undefined)
    throw new Error('Configure either endpoint or transport, not both.');
  const transport =
    options.transport ??
    (options.endpoint === undefined
      ? undefined
      : httpTransport({
          endpoint: options.endpoint,
          ...(options.headers === undefined
            ? {}
            : { headers: options.headers }),
        }));
  const {
    providers: _providers,
    providerScope: _scope,
    resourceGroups: _groups,
    requestPolicyGroups: _policyGroups,
    requestPolicy: _policy,
    ...runtime
  } = options;
  const client = new AcquisitionClient({
    ...runtime,
    retry: options.retry ?? {},
    scheduler: options.scheduler ?? defaultRetryScheduler,
    deadlineScheduler:
      options.deadlineScheduler ?? options.scheduler ?? defaultRetryScheduler,
    freshnessScheduler: options.freshnessScheduler ?? defaultRetryScheduler,
    pollingScheduler:
      options.pollingScheduler ??
      options.freshnessScheduler ??
      defaultRetryScheduler,
    retentionScheduler:
      options.retentionScheduler ??
      options.freshnessScheduler ??
      defaultRetryScheduler,
  });
  let disposed = false;
  return Object.freeze({
    watch: <Definition extends QueryDefinition>(
      definition: Definition,
      binding?: GraphQLResourceOptions,
    ) => {
      if (disposed) throw new Error('Client is disposed.');
      const resolved = configuration.resolve(binding);
      if (resolved.providers.transport === false)
        throw new Error('GraphQL transport is disabled for this resource.');
      const selected = resolved.providers.transport ?? transport;
      if (!selected)
        throw new Error('Resource requires a GraphQL transport or endpoint.');
      const source = definition.asSource(selected);
      const handle = client.watch(
        {
          stateAddress: source.stateAddress,
          selection: source.selection,
          ...(source.collection === undefined
            ? {}
            : { collection: source.collection }),
          authority: selected,
          read: source.read.bind(source),
          ...(source.fetchSelection
            ? { fetchSelection: source.fetchSelection.bind(source) }
            : {}),
          ...(source.fingerprint
            ? { fingerprint: source.fingerprint.bind(source) }
            : {}),
        },
        { requestPolicy: resolved.requestPolicy },
      );
      // The schema-validated source and the definition's inferred selection describe
      // this same projection; core keeps the untyped JSON storage/commit boundary.
      return handle as unknown as DefinitionHandle<Definition>;
    },
    dispose: () => {
      disposed = true;
      client.dispose();
    },
  });
}

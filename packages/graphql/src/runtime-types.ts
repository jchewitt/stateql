import type {
  AcquisitionSource,
  InputObject,
  InputValue,
  ResolvedField,
  ResourceScope,
} from '@jchewitt/stateql-core';
import type { GraphQLTransport } from './client.js';
import type { PreparedOperation } from './operation.js';

/** SDL is validated at runtime; dynamic names are not compile-time schema guarantees. */
export interface RuntimeSelection {
  readonly [field: string]:
    | true
    | {
        readonly as?: string;
        readonly args?: InputObject;
        readonly select?: RuntimeSelection;
      };
}
export interface RuntimeResource {
  field(name: string): RuntimeResource;
  select(selection: RuntimeSelection): RuntimeDefinition;
}
export interface RuntimeDefinition {
  readonly selection: readonly ResolvedField[];
  select(selection: RuntimeSelection): RuntimeDefinition;
  extend(selection: RuntimeSelection): RuntimeDefinition;
  bind(variables: InputObject, scope: ResourceScope): RuntimeBoundDefinition;
}
export interface RuntimeBoundDefinition {
  readonly resultType?: Readonly<Record<string, InputValue>>;
  readonly stateAddress: string;
  readonly selection: readonly ResolvedField[];
  prepare(target?: string): PreparedOperation;
  address(target: string, recordIdentity?: InputObject): string;
  asSource(transport: GraphQLTransport): AcquisitionSource;
}

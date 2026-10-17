import type {
  FieldSegment,
  InputObject,
  InputValue,
  ResolvedField,
} from './definition.js';
import type { Disposable, StoreReader } from './store-reader.js';

/** Internal adapter-facing store contracts, provisional during the proof of concept. */
export type RecordIdentity = InputObject;
export type FieldPath = readonly FieldSegment[];
export type StateChange =
  | { readonly kind: 'membership'; readonly records: readonly RecordIdentity[] }
  | {
      readonly kind: 'write';
      readonly record: RecordIdentity;
      readonly path: FieldPath;
      readonly value: InputValue;
    }
  | {
      readonly kind: 'object';
      readonly record: RecordIdentity;
      readonly path: FieldPath;
      readonly identity?: RecordIdentity;
    }
  | {
      readonly kind: 'stale';
      readonly record: RecordIdentity;
      readonly path: FieldPath;
    }
  | {
      readonly kind: 'error';
      readonly record: RecordIdentity;
      readonly path: FieldPath;
      readonly message: string;
    };

export interface FieldStatus {
  readonly path: readonly string[];
  readonly present: boolean;
  readonly stale: boolean;
  readonly error?: string;
}
export interface RecordSnapshot {
  readonly identity: RecordIdentity;
  /** Only fields declared by this consumer, using its response aliases. */
  readonly data: InputObject;
  readonly fields: readonly FieldStatus[];
}
export interface StateSnapshot {
  /** Undefined means membership has not been acquired; [] is a known empty list. */
  readonly records: readonly RecordSnapshot[] | undefined;
  readonly complete: boolean;
  readonly stale: boolean;
  readonly fetching: boolean;
}
export interface StateView extends StoreReader<StateSnapshot>, Disposable {
  readonly stateAddress: string;
  readonly selection: readonly ResolvedField[];
}

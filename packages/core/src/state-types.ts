import type {
  FieldSegment,
  InputObject,
  InputValue,
  ResolvedField,
} from './definition.js';
import type { Disposable, StoreReader } from './store-reader.js';
import type { SnapshotData } from './snapshot-data.js';

/** Internal adapter-facing store contracts, provisional during the proof of concept. */
export type RecordIdentity = InputObject;
export type FieldPath = readonly FieldSegment[];
export type StateChange =
  | { readonly kind: 'membership'; readonly records: readonly RecordIdentity[] }
  | { readonly kind: 'resource-null'; readonly error?: string }
  | { readonly kind: 'membership-stale' }
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
      readonly structuralNull?: boolean;
    };

export interface FieldStatus {
  readonly path: readonly string[];
  readonly present: boolean;
  readonly stale: boolean;
  readonly error?: string;
}
declare const snapshotResult: unique symbol;
type ResultWitness<Result> = unknown extends Result
  ? unknown
  : string extends keyof Result
    ? unknown
    : Result;

// Lower to actual output types before comparing producers. Comparing declaration
// models directly would let generic JSON masquerade as an all-optional selection.
export type RecordSnapshot<Result = InputObject> = RecordSnapshotOf<
  SnapshotData<Result>,
  ResultWitness<Result>
>;
interface RecordSnapshotOf<Data, Witness> {
  /** Type-only witness: erasing a selected model must not permit inventing a new one. */
  readonly [snapshotResult]?: Witness;
  readonly identity: RecordIdentity;
  /** Only fields declared by this consumer, using its response aliases. */
  readonly data: Data;
  readonly fields: readonly FieldStatus[];
}
export type StateSnapshot<Result = InputObject> = StateSnapshotOf<
  RecordSnapshot<Result>
>;
interface StateSnapshotOf<Record> {
  /** Undefined is unacquired, null is a null resource/ancestor, [] is an empty list. */
  readonly records: readonly Record[] | null | undefined;
  readonly resourceError: string | undefined;
  readonly complete: boolean;
  /** Unknown membership, or a narrow read detected added/missing records. */
  readonly membershipStale: boolean;
  readonly stale: boolean;
  readonly fetching: boolean;
}
export type StateView<Result = InputObject> = StateViewOf<
  StateSnapshot<Result>
>;
interface StateViewOf<Snapshot> extends StoreReader<Snapshot>, Disposable {
  readonly stateAddress: string;
  readonly selection: readonly ResolvedField[];
}

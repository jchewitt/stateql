import {
  AcquisitionClient,
  type AcquisitionSource,
  type InputObject,
  type InputValue,
  type QueryHandle,
  type QuerySnapshot,
  type RecordSnapshot,
  type SnapshotData,
  type StateSnapshot,
  type StateView,
  type StoreReader,
} from '../src/index.js';

type Model = {
  name: string;
  amount: number;
  enabled: boolean;
  user: { name: string; nickname: string | null };
  tags: (string | null)[];
  status: 'OPEN' | 'CLOSED';
};
declare const handle: QueryHandle<'name' | 'user.name', Model>;
const snapshot: QuerySnapshot<Model> = handle.getSnapshot();
const state: StateSnapshot<Model> = snapshot;
const reader: StoreReader<StateSnapshot<Model>> = handle;
declare const view: StateView<Model>;
const selectedView: StateSnapshot<Model> = view.getSnapshot();
declare const record: RecordSnapshot<Model>;
const name: string | undefined = record.data.name;
const nickname: string | null | undefined = record.data.user?.nickname;
const enabled: boolean | undefined = record.data.enabled;
const tags: readonly (string | null)[] | undefined = record.data.tags;
const status: 'OPEN' | 'CLOSED' | undefined = record.data.status;
void [state, reader, selectedView, name, nickname, enabled, tags, status];

const missing: SnapshotData<Model> = {};
const partial: SnapshotData<Model> = { user: { name: 'Ada' } };
// A structural branch failure can remove a declared non-null object.
const structuralNull: SnapshotData<Model> = { user: null };
void [missing, partial, structuralNull];
// @ts-expect-error Record data itself remains an object; only records/branches can be null.
const nullData: SnapshotData<Model> = null;
// @ts-expect-error Complete cached coverage does not establish schema-level availability.
const definiteAmount: number = record.data.amount;
// @ts-expect-error Only modeled selected properties are exposed.
record.data.unknown;
// @ts-expect-error Snapshots are readonly, including scalar properties.
record.data.name = 'changed';
if (record.data.user) {
  // @ts-expect-error Nested projected objects are readonly.
  record.data.user.name = 'changed';
}
// @ts-expect-error Arrays remain readonly even when the selected model used a mutable array.
record.data.tags?.push('changed');
// @ts-expect-error Array elements cannot acquire undefined through optional object fields.
const missingElement: SnapshotData<Model> = { tags: [undefined] };
// @ts-expect-error A non-null scalar array does not acquire structural object nullability.
const nullArray: SnapshotData<Model> = { tags: null };
// @ts-expect-error Scalar literal unions survive the availability projection.
const unknownStatus: SnapshotData<Model> = { status: 'UNKNOWN' };
void [nullData, definiteAmount, missingElement, nullArray, unknownStatus];
if (snapshot.complete && snapshot.records?.[0]) {
  // @ts-expect-error complete is availability metadata, not a type assertion on result values.
  const completeAmount: number = snapshot.records[0].data.amount;
  void completeAmount;
}
// @ts-expect-error A result generic must not widen the selected command targets.
void handle.refresh('amount');

// Defaulted and dynamic contracts retain the original generic JSON shape.
declare const legacy: QueryHandle<'name'>;
const legacySnapshot: QuerySnapshot = legacy.getSnapshot();
const legacyData: InputObject | undefined = legacySnapshot.records?.[0]?.data;
const genericValue: InputValue | undefined = legacyData?.['anything'];
declare const dynamic: SnapshotData<InputObject>;
declare const unknown: SnapshotData<unknown>;
const dynamicObject: InputObject = dynamic;
const unknownObject: InputObject = unknown;
void [genericValue, dynamicObject, unknownObject];
declare const unknownLeaves: SnapshotData<{ payload: unknown; loose: any }>;
const safePayload: InputValue | undefined = unknownLeaves.payload;
const safeLoose: InputValue | undefined = unknownLeaves.loose;
// @ts-expect-error Unknown selected leaves cannot claim a specific scalar type.
const uncheckedPayload: number = unknownLeaves.payload;
// @ts-expect-error any must not escape the snapshot's JSON value contract.
const uncheckedLoose: number = unknownLeaves.loose;
void [safePayload, safeLoose, uncheckedPayload, uncheckedLoose];
declare const source: AcquisitionSource;
const core = new AcquisitionClient();
const untyped: QueryHandle = core.watch(source);
const arbitrary: InputValue | undefined =
  untyped.getSnapshot().records?.[0]?.data['anything'];
void arbitrary;
// @ts-expect-error Portable sources do not acquire an unchecked result type from a caller assertion.
core.watch<Model>(source);

declare const strings: QueryHandle<string, { value: string }>;
declare const numbers: QueryHandle<string, { value: number }>;
declare const alternatives: QuerySnapshot<{ status: 'OPEN' | 'CLOSED' }>;
// @ts-expect-error Matching field names do not make incompatible scalar projections interchangeable.
const numberHandle: QueryHandle<string, { value: number }> = strings;
// @ts-expect-error Snapshot assignability must preserve scalar types independently of handles.
const stringSnapshot: QuerySnapshot<{ value: string }> = numbers.getSnapshot();
// @ts-expect-error A broader known scalar union cannot promise a narrower value.
const onlyOpen: QuerySnapshot<{ status: 'OPEN' }> = alternatives;
// @ts-expect-error A snapshot of different known fields cannot supply the selected expectation.
const missingSelection: QuerySnapshot<{ amount: number }> =
  strings.getSnapshot();
// @ts-expect-error Untyped snapshots must not gain asserted scalar types through assignment.
const typedFromGeneric: QueryHandle<string, { value: number }> = untyped;
// @ts-expect-error QuerySnapshot independently preserves the direction of typed result information.
const snapshotFromGeneric: QuerySnapshot<{ value: number }> =
  untyped.getSnapshot();
// @ts-expect-error Optional-only selected models still require an actual typed result witness.
const optionalFromGeneric: QueryHandle<string, { value?: number }> = untyped;
// @ts-expect-error Optional-only snapshot expectations cannot be invented from generic JSON.
const optionalSnapshot: QuerySnapshot<{ value?: number }> =
  untyped.getSnapshot();
void [
  numberHandle,
  stringSnapshot,
  onlyOpen,
  missingSelection,
  typedFromGeneric,
  snapshotFromGeneric,
  optionalFromGeneric,
  optionalSnapshot,
];

// Structural compatibility intentionally allows extra known fields when shared
// fields retain the correct type; accessing unselected fields is checked above.
declare const broader: QuerySnapshot<{ value: number; extra: string }>;
const narrower: QuerySnapshot<{ value: number }> = broader;
const legacyHandle: QueryHandle = numbers;
const erasedSnapshot: QuerySnapshot = narrower;
const erasedState: StateSnapshot = narrower;
declare const optionalTyped: QueryHandle<string, { value?: number }>;
const legacyOptionalHandle: QueryHandle = optionalTyped;
// @ts-expect-error Erasing the result type does not permit recovering an asserted selected model.
const roundTrip: QuerySnapshot<{ value: number }> = erasedSnapshot;
void [narrower, legacyHandle, erasedState, legacyOptionalHandle, roundTrip];

import type { InputObject, InputValue } from './definition.js';

type SnapshotValue<Value> = unknown extends Value
  ? InputValue
  : Value extends readonly (infer Item)[]
    ? readonly SnapshotValue<Item>[]
    : Value extends object
      ? SnapshotData<Value> | null
      : Value;

/** Selected data can be missing or failed even after acquisition settles.
 * Nested objects can be structurally null after an error, independently of schema nullability.
 * Dynamic definitions retain the existing JSON-shaped snapshot contract. */
export type SnapshotData<Result = InputObject> = unknown extends Result
  ? InputObject
  : Result extends object
    ? string extends keyof Result
      ? InputObject
      : { readonly [Key in keyof Result]?: SnapshotValue<Result[Key]> }
    : InputObject;

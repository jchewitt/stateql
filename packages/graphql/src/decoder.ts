import {
  getNamedType,
  isObjectType,
  isListType,
  isNonNullType,
  isScalarType,
  isEnumType,
  type GraphQLOutputType,
} from 'graphql';
import {
  canonicalInput,
  snapshotInput,
  type AcquiredField,
  type AcquiredRecord,
  type AcquisitionResult,
  type FieldPath,
  type InputObject,
  type InputValue,
  type ResolvedField,
} from '@tandrove/core';
import { fieldAt, containsList, type SchemaContext } from './schema.js';
import type { PathNode } from './definition.js';
import type { PreparedOperation } from './operation.js';
import { responseErrors, type ResponsePath } from './response-errors.js';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a GraphQL response object.');
  return value as Record<string, unknown>;
}
function scalar(type: GraphQLOutputType, value: unknown): InputValue {
  if (isNonNullType(type)) {
    if (value === null || value === undefined)
      throw new Error(`Missing non-null response: ${type}`);
    return scalar(type.ofType, value);
  }
  if (value === null) return null;
  if (isListType(type)) {
    if (!Array.isArray(value)) throw new Error('Expected a response list.');
    return value.map((item) => scalar(type.ofType, item));
  }
  if (!isScalarType(type) && !isEnumType(type))
    throw new Error('Expected a scalar response.');
  const serialized = type.serialize(value);
  if (canonicalInput(serialized) !== canonicalInput(value))
    throw new Error(`Invalid response scalar: ${type.name}`);
  return snapshotInput(serialized);
}
function identity(
  context: SchemaContext,
  typeName: string,
  data: Record<string, unknown>,
  required: boolean,
): InputObject | undefined {
  if (data['__typename'] !== typeName)
    throw new Error(`Missing or invalid __typename for ${typeName}.`);
  const fields = context.identities[typeName];
  if (!fields?.length) {
    if (required)
      throw new Error(`List requires configured identity: ${typeName}`);
    return undefined;
  }
  const result: Record<string, InputValue> = { __typename: typeName };
  for (const name of fields)
    result[name] = scalar(fieldAt(context, typeName, name).type, data[name]);
  return snapshotInput(result) as InputObject;
}

export function validateAcquisition(
  context: SchemaContext,
  path: readonly PathNode[],
  selection: readonly ResolvedField[],
): void {
  const last = path.at(-1)!;
  const target = getNamedType(
    fieldAt(context, last.parentType, last.name).type,
  );
  function check(typeName: string, fields: readonly ResolvedField[]): void {
    for (const selected of fields) {
      const field = fieldAt(context, typeName, selected.name);
      const named = getNamedType(field.type);
      if (isObjectType(named)) {
        if (containsList(field))
          throw new Error(
            'Nested object-list acquisition is not implemented yet.',
          );
        check(named.name, selected.children);
      }
    }
  }
  check(target.name, selection);
}

/** Decode successes and located failures before the core makes one atomic commit. */
export function decodeAcquisition(
  context: SchemaContext,
  path: readonly PathNode[],
  operation: PreparedOperation,
  response: unknown,
): AcquisitionResult {
  const envelope = object(response);
  const errors = responseErrors(context, operation, envelope);
  const nullResource = (responsePath: ResponsePath): AcquisitionResult => {
    const error = errors.at(responsePath);
    errors.assertConsumed();
    return { kind: 'null', ...(error === undefined ? {} : { error }) };
  };
  let data: unknown = envelope['data'];
  if (data === null) {
    if (errors.at([]) === undefined)
      throw new Error('Null GraphQL data requires an execution error.');
    return nullResource([]);
  }
  for (let index = 0; index < path.length; index++) {
    const node = path[index]!;
    data = object(data)[node.name];
    if (data === null) {
      if (isNonNullType(fieldAt(context, node.parentType, node.name).type))
        throw new Error(`Null non-null resource: ${node.name}`);
      return nullResource(path.slice(0, index + 1).map((part) => part.name));
    }
    if (index < path.length - 1)
      identity(
        context,
        getNamedType(fieldAt(context, node.parentType, node.name).type).name,
        object(data),
        false,
      );
  }
  const last = path.at(-1)!;
  const field = fieldAt(context, last.parentType, last.name);
  const typeName = getNamedType(field.type).name;
  const list = containsList(field);
  if (list && !Array.isArray(data))
    throw new Error('Expected a resource list.');
  const items: unknown[] = list ? (data as unknown[]) : [data];
  const records: AcquiredRecord[] = items.map((item, index) => {
    const record = object(item);
    const recordIdentity = identity(context, typeName, record, list) ?? {
      __resource: typeName,
    };
    const fields: AcquiredField[] = [];
    function decode(
      typeName: string,
      data: Record<string, unknown>,
      selection: readonly ResolvedField[],
      parent: FieldPath,
      responseParent: ResponsePath,
    ): void {
      for (const selected of selection) {
        if (!Object.hasOwn(data, selected.responseName)) continue;
        const value = data[selected.responseName];
        const field = fieldAt(context, typeName, selected.name);
        const target = getNamedType(field.type);
        const path = [
          ...parent,
          { name: selected.name, arguments: selected.arguments },
        ];
        const responsePath = [...responseParent, selected.responseName];
        const error = errors.at(responsePath, !isObjectType(target));
        if (error !== undefined) {
          // A failed scalar-list element does not excuse malformed siblings.
          // Validate the full returned leaf even though its cached value is retained.
          if (!isObjectType(target)) scalar(field.type, value);
          fields.push({
            kind: 'error',
            path,
            message: error,
            ...(isObjectType(target) ? { structuralNull: true } : {}),
          });
          continue;
        }
        if (value === null) {
          if (isNonNullType(field.type))
            throw new Error(`Null non-null field: ${selected.name}`);
          fields.push({ kind: 'write', path, value: null });
        } else if (isObjectType(target)) {
          const child = object(value);
          const childIdentity = identity(context, target.name, child, false);
          fields.push({
            kind: 'object',
            path,
            ...(childIdentity === undefined ? {} : { identity: childIdentity }),
          });
          decode(target.name, child, selected.children, path, responsePath);
        } else
          fields.push({
            kind: 'write',
            path,
            value: scalar(field.type, value),
          });
      }
    }
    decode(
      typeName,
      record,
      operation.selection,
      [],
      [...operation.responsePath, ...(list ? [index] : [])],
    );
    return { identity: recordIdentity, fields };
  });
  errors.assertConsumed();
  return records;
}

import {
  buildSchema,
  assertValidSchema,
  coerceInputValue,
  getNamedType,
  isEnumType,
  isInputObjectType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isSpecifiedScalarType,
  isSpecifiedDirective,
  type GraphQLField,
  type GraphQLObjectType,
  type GraphQLSchema,
} from 'graphql';
import {
  snapshotInput,
  freezeFields,
  type InputObject,
  type ResolvedField,
} from '@jchewitt/stateql-core';

export interface SchemaOptions {
  readonly identities?: Readonly<Record<string, readonly string[]>>;
}
export interface SchemaContext {
  readonly schema: GraphQLSchema;
  readonly identities: Readonly<Record<string, readonly string[]>>;
}

export function inspectSchema(
  source: string,
  options: SchemaOptions = {},
): SchemaContext {
  const schema = buildSchema(source);
  assertValidSchema(schema);
  if (!schema.getQueryType()) throw new Error('A query root is required.');
  for (const directive of schema.getDirectives())
    if (!isSpecifiedDirective(directive))
      throw new Error(`Custom directive unsupported: ${directive.name}`);
  for (const type of Object.values(schema.getTypeMap())) {
    if (type.name.startsWith('__')) continue;
    if (isScalarType(type) && !isSpecifiedScalarType(type))
      throw new Error(`Custom scalar unsupported: ${type.name}`);
    if (
      !isScalarType(type) &&
      !isEnumType(type) &&
      !isObjectType(type) &&
      !isInputObjectType(type)
    )
      throw new Error(`Abstract type unsupported: ${type.name}`);
    if (isInputObjectType(type) && type.isOneOf)
      throw new Error(`OneOf input unsupported: ${type.name}`);
  }
  const identities: Record<string, readonly string[]> = Object.create(
    null,
  ) as Record<string, readonly string[]>;
  for (const [name, fields] of Object.entries(options.identities ?? {})) {
    const type = schema.getType(name);
    if (
      !isObjectType(type) ||
      !fields.length ||
      new Set(fields).size !== fields.length
    )
      throw new Error(`Invalid identity configuration: ${name}`);
    for (const key of fields) {
      const field = type.getFields()[key];
      if (
        !field ||
        field.args.length ||
        !isNonNullType(field.type) ||
        (!isScalarType(field.type.ofType) && !isEnumType(field.type.ofType))
      )
        throw new Error(
          `Identity must be a required scalar without arguments: ${name}.${key}`,
        );
    }
    identities[name] = Object.freeze([...fields]);
  }
  return Object.freeze({ schema, identities: Object.freeze(identities) });
}

export function objectType(
  context: SchemaContext,
  name: string,
): GraphQLObjectType {
  const type = context.schema.getType(name);
  if (!isObjectType(type)) throw new Error(`Expected object type: ${name}`);
  return type;
}

export function fieldAt(
  context: SchemaContext,
  typeName: string,
  name: string,
): GraphQLField<unknown, unknown> {
  const field = objectType(context, typeName).getFields()[name];
  if (!field) throw new Error(`Unknown field: ${typeName}.${name}`);
  return field;
}

export function inputObject(value: unknown): InputObject {
  const result = snapshotInput(value);
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('Expected an argument object.');
  return result as InputObject;
}

export function resolveArguments(
  field: GraphQLField<unknown, unknown>,
  input: unknown,
): InputObject {
  const values = inputObject(input);
  for (const name of Object.keys(values))
    if (!field.args.some((arg) => arg.name === name))
      throw new Error(`Unknown argument: ${field.name}.${name}`);
  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const arg of field.args) {
    const value = values[arg.name];
    if (value === undefined) {
      if (arg.defaultValue !== undefined) result[arg.name] = arg.defaultValue;
      else if (isNonNullType(arg.type))
        throw new Error(`Missing argument: ${field.name}.${arg.name}`);
    } else result[arg.name] = coerceInputValue(value, arg.type);
  }
  return inputObject(result);
}

export function resolveSelection(
  context: SchemaContext,
  typeName: string,
  input: unknown,
): readonly ResolvedField[] {
  const selection = inputObject(input);
  if (!Object.keys(selection).length)
    throw new Error('Selection must not be empty.');
  const fields = Object.entries(selection).map(([name, option]) => {
    const field = fieldAt(context, typeName, name);
    const config = option === true ? {} : inputObject(option);
    for (const key of Object.keys(config))
      if (!['as', 'args', 'select'].includes(key))
        throw new Error(`Unsupported selection option: ${key}`);
    const responseName = config['as'] ?? name;
    if (
      typeof responseName !== 'string' ||
      !/^[_A-Za-z][_0-9A-Za-z]*$/.test(responseName) ||
      responseName.startsWith('__')
    )
      throw new Error(`Invalid alias: ${String(responseName)}`);
    const target = getNamedType(field.type);
    const children = isObjectType(target)
      ? resolveSelection(context, target.name, config['select'])
      : [];
    if (!isObjectType(target) && config['select'] !== undefined)
      throw new Error(`Scalar cannot have a selection: ${name}`);
    return {
      name,
      responseName,
      arguments: resolveArguments(
        field,
        config['args'] === undefined ? {} : config['args'],
      ),
      children,
    };
  });
  // An alias cannot shadow an identity/context field that the compiler must inject.
  const reserved = new Set(context.identities[typeName] ?? []);
  for (const field of fields)
    if (field.responseName !== field.name && reserved.has(field.responseName))
      throw new Error(`Alias shadows identity field: ${field.responseName}`);
  return freezeFields(fields);
}

export function containsList(field: GraphQLField<unknown, unknown>): boolean {
  return isListType(isNonNullType(field.type) ? field.type.ofType : field.type);
}

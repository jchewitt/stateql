import {
  isEnumType,
  isInputObjectType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  printSchema,
  type GraphQLInputType,
  type GraphQLType,
} from 'graphql';
import { inspectSchema, type SchemaOptions } from './schema.js';

/** Pure code generation; CLI/file I/O belongs to the consuming application's script. */
export function generateSchemaModule(
  source: string,
  options: SchemaOptions = {},
): string {
  const { schema } = inspectSchema(source, options);
  if (schema.getQueryType()!.name !== 'Query')
    throw new Error('This prototype requires a query root named Query.');
  function typeText(type: GraphQLType): string {
    if (isNonNullType(type)) return nonNull(type.ofType);
    return `${nonNull(type)} | null`;
  }
  function nonNull(type: GraphQLType): string {
    if (isListType(type)) return `readonly (${typeText(type.ofType)})[]`;
    if (isNonNullType(type)) return nonNull(type.ofType);
    if (isScalarType(type))
      return type.name === 'Boolean'
        ? 'boolean'
        : ['Int', 'Float'].includes(type.name)
          ? 'number'
          : 'string';
    if (isEnumType(type))
      return type
        .getValues()
        .map((value) => JSON.stringify(value.name))
        .join(' | ');
    if (isObjectType(type)) return `ObjectRef<${JSON.stringify(type.name)}>`;
    if (isInputObjectType(type)) return `Inputs[${JSON.stringify(type.name)}]`;
    throw new Error(`Unsupported type: ${String(type)}`);
  }
  const optional = (type: GraphQLInputType, defaultValue: unknown) =>
    isNonNullType(type) && defaultValue === undefined ? '' : '?';
  const types = Object.values(schema.getTypeMap())
    .filter((type) => !type.name.startsWith('__'))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const inputs = types
    .filter(isInputObjectType)
    .map(
      (type) =>
        `${JSON.stringify(type.name)}: { ${Object.values(type.getFields())
          .map(
            (field) =>
              `readonly ${JSON.stringify(field.name)}${optional(field.type, field.defaultValue)}: ${typeText(field.type)}`,
          )
          .join('; ')} };`,
    )
    .join('\n');
  const objects = types
    .filter(isObjectType)
    .map(
      (type) =>
        `${JSON.stringify(type.name)}: {\n${Object.values(type.getFields())
          .map((field) => {
            const args = field.args
              .map(
                (arg) =>
                  `readonly ${JSON.stringify(arg.name)}${optional(arg.type, arg.defaultValue)}: ${typeText(arg.type)}`,
              )
              .join('; ');
            return `readonly ${JSON.stringify(field.name)}: FieldType<${typeText(field.type)}, { ${args} }>;`;
          })
          .join('\n')}\n};`,
    )
    .join('\n');
  const objectImport = objects.includes('ObjectRef<') ? ', type ObjectRef' : '';
  return `// Generated from the GraphQL schema. Do not edit.\nimport { createSchema, type FieldType${objectImport} } from '@tandrove/graphql';\n${inputs ? `export type Inputs = {\n${inputs}\n};\n` : ''}export type GeneratedTypes = {\n${objects}\n};\nexport const schema = createSchema<GeneratedTypes>(${JSON.stringify(printSchema(schema))}, ${JSON.stringify(options)});\n`;
}

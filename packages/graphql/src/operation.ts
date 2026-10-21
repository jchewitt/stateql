import {
  Kind,
  OperationTypeNode,
  getNamedType,
  isObjectType,
  parseType,
  print,
  validate,
  type ArgumentNode,
  type DocumentNode,
  type FieldNode,
  type GraphQLField,
  type SelectionNode,
  type VariableDefinitionNode,
} from 'graphql';
import {
  canonicalInput,
  snapshotInput,
  type FieldSegment,
  type InputObject,
  type ResolvedField,
} from '@launch-echo/stateql-core';
import { containsList, fieldAt, type SchemaContext } from './schema.js';
import type { PathNode } from './definition.js';

export interface PreparedOperation {
  readonly document: DocumentNode;
  readonly query: string;
  readonly variables: InputObject;
  readonly stateAddress: string;
  readonly fingerprint: string;
  /** Requested domain fields, excluding automatically fetched identity/context fields. */
  readonly selection: readonly ResolvedField[];
  readonly responsePath: readonly string[];
}

export function compileOperation(
  context: SchemaContext,
  path: readonly PathNode[],
  segments: readonly FieldSegment[],
  selection: readonly ResolvedField[],
  stateAddress: string,
): PreparedOperation {
  const definitions: VariableDefinitionNode[] = [];
  const variables: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  const name = (value: string) => ({ kind: Kind.NAME as const, value });
  function argumentsFor(
    field: GraphQLField<unknown, unknown>,
    args: InputObject,
  ): ArgumentNode[] {
    return Object.keys(args)
      .sort()
      .map((key) => {
        const variable = `v${definitions.length}`;
        const argument = field.args.find(
          (candidate) => candidate.name === key,
        )!;
        definitions.push({
          kind: Kind.VARIABLE_DEFINITION,
          variable: { kind: Kind.VARIABLE, name: name(variable) },
          type: parseType(String(argument.type), { noLocation: true }),
        });
        variables[variable] = args[key];
        return {
          kind: Kind.ARGUMENT,
          name: name(key),
          value: { kind: Kind.VARIABLE, name: name(variable) },
        };
      });
  }
  function withIdentity(typeName: string, fields: FieldNode[]): FieldNode[] {
    const result = [...fields];
    for (const key of ['__typename', ...(context.identities[typeName] ?? [])]) {
      if (
        !result.some(
          (field) => field.name.value === key && field.alias === undefined,
        )
      )
        result.push({ kind: Kind.FIELD, name: name(key) });
    }
    return result.sort((a, b) =>
      a.name.value < b.name.value ? -1 : a.name.value > b.name.value ? 1 : 0,
    );
  }
  function verifyListIdentity(field: GraphQLField<unknown, unknown>): void {
    const target = getNamedType(field.type);
    if (
      containsList(field) &&
      isObjectType(target) &&
      !context.identities[target.name]?.length
    )
      throw new Error(`List requires configured identity: ${target.name}`);
  }
  function fieldsFor(
    typeName: string,
    fields: readonly ResolvedField[],
  ): FieldNode[] {
    return withIdentity(
      typeName,
      fields.map((selected) => {
        const field = fieldAt(context, typeName, selected.name);
        verifyListIdentity(field);
        const target = getNamedType(field.type);
        return {
          kind: Kind.FIELD,
          name: name(selected.name),
          ...(selected.responseName === selected.name
            ? {}
            : { alias: name(selected.responseName) }),
          arguments: argumentsFor(field, selected.arguments),
          ...(isObjectType(target)
            ? {
                selectionSet: {
                  kind: Kind.SELECTION_SET as const,
                  selections: fieldsFor(target.name, selected.children),
                },
              }
            : {}),
        };
      }),
    );
  }
  function wrap(index: number): FieldNode {
    const node = path[index]!;
    const field = fieldAt(context, node.parentType, node.name);
    verifyListIdentity(field);
    const args = argumentsFor(field, segments[index]!.arguments);
    const target = getNamedType(field.type);
    const children: SelectionNode[] =
      index === path.length - 1
        ? fieldsFor(target.name, selection)
        : withIdentity(target.name, [wrap(index + 1)]);
    return {
      kind: Kind.FIELD,
      name: name(node.name),
      arguments: args,
      selectionSet: { kind: Kind.SELECTION_SET, selections: children },
    };
  }
  const root = wrap(0);
  const document: DocumentNode = {
    kind: Kind.DOCUMENT,
    definitions: [
      {
        kind: Kind.OPERATION_DEFINITION,
        operation: OperationTypeNode.QUERY,
        name: name('StateQLRead'),
        variableDefinitions: definitions,
        selectionSet: { kind: Kind.SELECTION_SET, selections: [root] },
      },
    ],
  };
  const errors = validate(context.schema, document);
  if (errors.length)
    throw new Error(errors.map((error) => error.message).join('; '));
  const query = print(document);
  const immutableVariables = snapshotInput(variables) as InputObject;
  // Freeze the generated AST so a caller cannot invalidate the request fingerprint.
  function freeze(value: unknown): void {
    if (value !== null && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  }
  freeze(document);
  return Object.freeze({
    document,
    query,
    variables: immutableVariables,
    stateAddress,
    fingerprint: canonicalInput([stateAddress, query, immutableVariables]),
    selection,
    responsePath: Object.freeze(path.map((node) => node.name)),
  });
}

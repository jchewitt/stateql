import {
  Kind,
  GraphQLNonNull,
  GraphQLString,
  isListType,
  isNonNullType,
  isObjectType,
  type GraphQLOutputType,
  type SelectionSetNode,
  type SelectionNode,
} from 'graphql';
import type { PreparedOperation } from './operation.js';
import type { SchemaContext } from './schema.js';

export type ResponsePath = readonly (string | number)[];
const prefix = (parent: ResponsePath, child: ResponsePath) =>
  parent.length <= child.length && parent.every((part, i) => part === child[i]);

/**
 * Resolve execution errors against the generated operation, including aliases,
 * injected identities and list indexes. Null bubbling stops at the nearest
 * nullable response position; malformed/unlocatable errors reject the envelope.
 */
export function responseErrors(
  context: SchemaContext,
  operation: PreparedOperation,
  envelope: Record<string, unknown>,
): {
  at(path: ResponsePath, descendants?: boolean): string | undefined;
  assertConsumed(): void;
} {
  const raw = envelope['errors'];
  if (raw !== undefined && !Array.isArray(raw))
    throw new Error('Malformed GraphQL errors.');
  const failures: { path: ResponsePath; message: string; consumed: boolean }[] =
    [];
  for (const value of (raw ?? []) as unknown[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Malformed GraphQL error.');
    const error = value as Record<string, unknown>;
    const message = error['message'];
    const path = error['path'];
    if (typeof message !== 'string' || !message)
      throw new Error('GraphQL error requires a message.');
    if (!Array.isArray(path) || !path.length) throw new Error(message);
    let type: GraphQLOutputType = context.schema.getQueryType()!;
    const definition = operation.document.definitions[0]!;
    if (definition.kind !== Kind.OPERATION_DEFINITION)
      throw new Error('Expected a generated query operation.');
    let selection: SelectionSetNode | undefined = definition.selectionSet;
    let boundary: ResponsePath = [];
    const walked: (string | number)[] = [];
    for (const part of path as unknown[]) {
      const unwrapped: GraphQLOutputType = isNonNullType(type)
        ? type.ofType
        : type;
      if (isListType(unwrapped)) {
        if (typeof part !== 'number' || !Number.isSafeInteger(part) || part < 0)
          throw new Error('Invalid GraphQL error list index.');
        type = unwrapped.ofType;
      } else {
        if (typeof part !== 'string' || !isObjectType(unwrapped))
          throw new Error('Invalid GraphQL error path.');
        const field: SelectionNode | undefined = selection?.selections.find(
          (node) =>
            node.kind === Kind.FIELD &&
            (node.alias?.value ?? node.name.value) === part,
        );
        if (!field || field.kind !== Kind.FIELD)
          throw new Error('GraphQL error path is outside the operation.');
        type =
          field.name.value === '__typename'
            ? new GraphQLNonNull(GraphQLString)
            : unwrapped.getFields()[field.name.value]!.type;
        selection = field.selectionSet;
      }
      walked.push(part as string | number);
      if (!isNonNullType(type)) boundary = [...walked];
    }
    failures.push({ path: boundary, message, consumed: false });
  }
  const declaredBoundaries = failures.map((failure) => failure.path);
  for (const failure of failures) {
    let data: unknown = envelope['data'];
    const observed: (string | number)[] = [];
    for (const part of failure.path) {
      // Another execution error can null an ancestor of this error's normal
      // boundary. Preserve both failures only when an error explains that bubble.
      if (data === null) {
        if (
          !declaredBoundaries.some(
            (path) => path.length === observed.length && prefix(path, observed),
          )
        )
          throw new Error(
            'Unexplained null ancestor in GraphQL error response.',
          );
        break;
      }
      if (typeof part === 'number') {
        if (!Array.isArray(data) || part >= data.length)
          throw new Error('GraphQL error index is outside the response.');
        data = data[part];
      } else {
        if (
          !data ||
          typeof data !== 'object' ||
          Array.isArray(data) ||
          !Object.hasOwn(data, part)
        )
          throw new Error('GraphQL error path is absent from the response.');
        data = (data as Record<string, unknown>)[part];
      }
      observed.push(part);
    }
    if (data !== null)
      throw new Error(
        'GraphQL execution error must resolve to a null response position.',
      );
    failure.path = observed;
  }
  return {
    at(path, descendants = false) {
      const matching = failures.filter(
        (failure) =>
          prefix(path, failure.path) &&
          (descendants || path.length === failure.path.length),
      );
      matching.forEach((failure) => {
        failure.consumed = true;
      });
      return matching.length
        ? matching.map((failure) => failure.message).join('; ')
        : undefined;
    },
    assertConsumed() {
      if (failures.some((failure) => !failure.consumed))
        throw new Error(
          'GraphQL error cannot be safely mapped to acquired state.',
        );
    },
  };
}

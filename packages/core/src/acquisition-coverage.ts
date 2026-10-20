import { canonicalInput, type ResolvedField } from './definition.js';
import type { FieldPath, RecordIdentity, StateChange } from './state-types.js';
import type { AcquiredField } from './acquisition.js';

/** Canonical paths ignore response aliases but retain arguments. */
export function pathPrefix(parent: FieldPath, child: FieldPath): boolean {
  return (
    parent.length <= child.length &&
    parent.every(
      (part, index) =>
        part.name === child[index]!.name &&
        canonicalInput(part.arguments) ===
          canonicalInput(child[index]!.arguments),
    )
  );
}

export function leafPaths(
  fields: readonly ResolvedField[],
  parent: FieldPath = [],
): readonly FieldPath[] {
  return fields.flatMap((field) => {
    const path = [...parent, { name: field.name, arguments: field.arguments }];
    return field.children.length ? leafPaths(field.children, path) : [path];
  });
}

export function fieldAtPath(
  path: FieldPath,
  fields: readonly ResolvedField[],
): ResolvedField | undefined {
  const [first, ...rest] = path;
  if (!first) return undefined;
  const match = fields.find((field) => pathPrefix([first], [field]));
  return rest.length && match ? fieldAtPath(rest, match.children) : match;
}

export function staleChanges(
  records: readonly { readonly identity: RecordIdentity }[],
  paths: readonly FieldPath[],
): StateChange[] {
  return records.flatMap((record) =>
    paths.map((path) => ({
      kind: 'stale' as const,
      record: record.identity,
      path,
    })),
  );
}

/** A successful ancestor null satisfies its subtree; an object marker alone does not. */
export function hasOmissions(
  fields: readonly AcquiredField[],
  requested: readonly FieldPath[],
): boolean {
  return requested.some(
    (path) =>
      !fields.some(
        (field) =>
          field.kind !== 'object' &&
          pathPrefix(field.path, path) &&
          (field.path.length === path.length ||
            field.kind === 'error' ||
            field.value === null),
      ),
  );
}

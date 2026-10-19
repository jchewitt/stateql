import {
  canonicalInput,
  snapshotInput,
  type ResolvedField,
} from './definition.js';
import {
  fieldAtPath,
  hasOmissions,
  leafPaths,
  pathPrefix,
  staleChanges,
} from './acquisition-coverage.js';
import { snapshotIdentity } from './state-identity.js';
import type { AcquiredRecord } from './acquisition.js';
import type { FieldPath, RecordSnapshot, StateChange } from './state-types.js';

interface Reconciliation {
  readonly changes: readonly StateChange[];
  /** Successful matching writes can commit even when a narrow refresh is incomplete. */
  readonly incomplete: string | undefined;
}

/** Decide membership and field commits together before mutating the store. */
export function reconcileAcquisition(options: {
  readonly acquired: readonly AcquiredRecord[];
  readonly known: readonly RecordSnapshot[] | undefined;
  readonly requested: readonly ResolvedField[];
  readonly fetched: readonly ResolvedField[];
  readonly collection: boolean;
  readonly replaceMembership: boolean;
  readonly pendingInvalidations: readonly FieldPath[];
}): Reconciliation {
  const {
    acquired,
    known,
    requested,
    fetched,
    collection,
    replaceMembership,
    pendingInvalidations,
  } = options;
  const ids = acquired.map((record) =>
    canonicalInput(snapshotIdentity(record.identity)),
  );
  if (new Set(ids).size !== ids.length)
    throw new Error('Duplicate acquired identity.');
  // Validate even records that will be ignored. Bad data must not partly commit.
  for (const record of acquired) {
    if (!Array.isArray(record.fields))
      throw new Error('Source must return record fields.');
    const seen: FieldPath[] = [];
    for (const field of record.fields) {
      const fetchedField = fieldAtPath(field.path, fetched);
      if (
        (field.kind !== 'write' && field.kind !== 'object') ||
        !fetchedField ||
        (field.kind === 'object' && !fetchedField.children.length) ||
        (field.kind === 'write' &&
          fetchedField.children.length &&
          field.value !== null)
      )
        throw new Error(
          'Source returned an invalid write or a write outside fetched coverage.',
        );
      if (field.kind === 'object' && field.identity !== undefined)
        snapshotIdentity(field.identity);
      // snapshotInput omits undefined object properties. Validate value again
      // before filtering, including fields/records that will not be committed.
      if (field.kind === 'write') snapshotInput(field.value);
      if (
        seen.some(
          (path) =>
            path.length === field.path.length && pathPrefix(path, field.path),
        )
      )
        throw new Error('Duplicate acquired field path.');
      seen.push(field.path);
    }
    if (
      record.fields.some(
        (field) =>
          field.kind === 'write' &&
          record.fields.some(
            (other) =>
              other.path.length > field.path.length &&
              pathPrefix(field.path, other.path),
          ),
      )
    )
      throw new Error(
        'Acquired scalar/null field cannot also have descendant writes.',
      );
  }
  const existing = new Set(
    known?.map((record) => canonicalInput(record.identity)),
  );
  const returned = new Set(ids);
  const missing =
    known?.filter((record) => !returned.has(canonicalInput(record.identity))) ??
    [];
  const changed =
    known !== undefined &&
    (missing.length > 0 || ids.some((id) => !existing.has(id)));
  if (changed && !collection)
    throw new Error('Membership changed for a non-collection resource.');

  const replacing = replaceMembership || known === undefined;
  const matched = replacing
    ? acquired
    : acquired.filter((record) =>
        existing.has(canonicalInput(record.identity)),
      );
  const paths = leafPaths(requested);
  const omitted = matched.some((record) => hasOmissions(record.fields, paths));
  // A whole-list replacement must be usable for its calling view before admission.
  if (replaceMembership && omitted)
    throw new Error('Source omitted requested fields during list refresh.');
  const changes: StateChange[] = replacing
    ? [
        {
          kind: 'membership',
          records: acquired.map((record) => record.identity),
        },
      ]
    : changed
      ? [{ kind: 'membership-stale' }]
      : [];
  for (const record of matched)
    // Sources return a field tree, not an ordered patch program. Establish
    // ancestor identities before their children regardless of response ordering.
    for (const field of [...record.fields].sort(
      (a, b) => a.path.length - b.path.length,
    ))
      if (fieldAtPath(field.path, requested))
        changes.push({ ...field, record: record.identity });
  if (!replacing) changes.push(...staleChanges(missing, paths));
  // Include retained missing members, but never patch ignored unknown members.
  changes.push(
    ...staleChanges(replacing ? acquired : known!, pendingInvalidations),
  );
  return {
    changes,
    incomplete:
      !replacing && missing.length
        ? 'Field refresh incomplete: known records were missing; use refreshList() to reconcile membership.'
        : omitted
          ? 'Source omitted requested fields.'
          : undefined,
  };
}

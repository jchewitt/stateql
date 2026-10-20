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
import type { AcquiredRecord, AcquisitionResult } from './acquisition.js';
import type { FieldPath, RecordSnapshot, StateChange } from './state-types.js';

interface Reconciliation {
  readonly changes: readonly StateChange[];
  /** Successful matching writes can commit even when a narrow refresh is incomplete. */
  readonly incomplete: string | undefined;
}
function errorMessages(
  records: readonly AcquiredRecord[],
  requested: readonly ResolvedField[],
): string[] {
  return records.flatMap((record) =>
    record.fields.flatMap((field) =>
      field.kind === 'error' && fieldAtPath(field.path, requested)
        ? [field.message]
        : [],
    ),
  );
}

/** Decide membership and field commits together before mutating the store. */
export function reconcileAcquisition(options: {
  readonly acquired: AcquisitionResult;
  readonly known: readonly RecordSnapshot[] | null | undefined;
  readonly requested: readonly ResolvedField[];
  readonly fetched: readonly ResolvedField[];
  readonly collection: boolean;
  readonly replaceMembership: boolean;
  readonly pendingInvalidations: readonly FieldPath[];
  /** Decoded event patches supply existing records only, not a complete list read. */
  readonly patch?: boolean;
}): Reconciliation {
  const {
    acquired: response,
    known,
    requested,
    fetched,
    collection,
    replaceMembership,
    pendingInvalidations,
    patch = false,
  } = options;
  if (
    patch &&
    (!Array.isArray(response) || !Array.isArray(known) || !response.length)
  )
    throw new Error('Patch requires nonempty records and acquired membership.');
  if (!Array.isArray(response)) {
    if (
      !response ||
      typeof response !== 'object' ||
      !('kind' in response) ||
      response.kind !== 'null' ||
      (response.error !== undefined &&
        (typeof response.error !== 'string' || !response.error))
    )
      throw new Error(
        'Source must return records or an explicit null resource.',
      );
    return {
      changes: [
        {
          kind: 'resource-null',
          ...(response.error === undefined ? {} : { error: response.error }),
        },
        ...(pendingInvalidations.length
          ? [{ kind: 'membership-stale' as const }]
          : []),
      ],
      incomplete: response.error,
    };
  }
  const acquired = response as readonly AcquiredRecord[];
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
        (field.kind !== 'write' &&
          field.kind !== 'object' &&
          field.kind !== 'error') ||
        !fetchedField ||
        (field.kind === 'object' && !fetchedField.children.length) ||
        (field.kind === 'write' &&
          fetchedField.children.length &&
          field.value !== null)
      )
        throw new Error(
          'Source returned an invalid write or a write outside fetched coverage.',
        );
      if (
        field.kind === 'error' &&
        (typeof field.message !== 'string' ||
          !field.message ||
          (field.structuralNull !== undefined &&
            typeof field.structuralNull !== 'boolean') ||
          (field.structuralNull === true && !fetchedField.children.length))
      )
        throw new Error('Source returned an invalid field error.');
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
          field.kind !== 'object' &&
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
  if (patch && ids.some((id) => !existing.has(id)))
    throw new Error('Patch cannot insert or replace an unknown record.');
  const missing =
    (patch
      ? []
      : known?.filter(
          (record) => !returned.has(canonicalInput(record.identity)),
        )) ?? [];
  const changed =
    known !== undefined &&
    (missing.length > 0 || ids.some((id) => !existing.has(id)));
  if (!collection && acquired.length > 1)
    throw new Error('Non-collection sources must return at most one record.');
  const failures = errorMessages(acquired, requested);
  // Incomplete list reads can patch known records, but cannot admit new membership.
  const replacing =
    (replaceMembership && !failures.length) ||
    known == null ||
    (!collection && changed);
  const matched = replacing
    ? acquired
    : acquired.filter((record) =>
        existing.has(canonicalInput(record.identity)),
      );
  const paths = leafPaths(requested);
  const omitted = matched.some((record) => hasOmissions(record.fields, paths));
  if (patch && omitted) throw new Error('Patch omitted selected fields.');
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
    : changed || (replaceMembership && failures.length)
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
  for (const record of matched)
    changes.push(
      ...staleChanges(
        [record],
        paths.filter((path) => hasOmissions(record.fields, [path])),
      ),
    );
  if (!replacing) changes.push(...staleChanges(missing, paths));
  // Include retained missing members, but never patch ignored unknown members.
  changes.push(
    ...staleChanges(replacing ? acquired : known!, pendingInvalidations),
  );
  const errors = replaceMembership
    ? failures
    : errorMessages(matched, requested);
  return {
    changes,
    incomplete: errors.length
      ? errors.join('; ')
      : !replacing && missing.length
        ? 'Field refresh incomplete: known records were missing; use refreshList() to reconcile membership.'
        : omitted
          ? 'Source omitted requested fields.'
          : undefined,
  };
}

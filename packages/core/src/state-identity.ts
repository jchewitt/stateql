import { snapshotInput } from './definition.js';
import type { RecordIdentity } from './state-types.js';

export function snapshotIdentity(value: RecordIdentity): RecordIdentity {
  const copied = snapshotInput(value);
  if (
    !copied ||
    typeof copied !== 'object' ||
    Array.isArray(copied) ||
    !Object.keys(copied).length
  )
    throw new Error('Record identity must be a nonempty object.');
  return copied as RecordIdentity;
}

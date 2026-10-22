import type { AcquisitionSource } from './acquisition.js';
import { createProviderToken } from './provider.js';
import { validatedSelection } from './state-store.js';

/** Capability validation; results still pass the ordinary acquisition commit boundary. */
export function createAcquisitionSourceToken(
  description = 'Acquisition source',
) {
  return createProviderToken<AcquisitionSource>(
    description,
    isAcquisitionSource,
  );
}
export function isAcquisitionSource(
  value: unknown,
): value is AcquisitionSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<AcquisitionSource>;
  const authority = source.authority;
  return (
    typeof source.stateAddress === 'string' &&
    source.stateAddress.length > 0 &&
    typeof source.read === 'function' &&
    (authority === undefined || isAuthority(authority)) &&
    (source.collection === undefined ||
      typeof source.collection === 'boolean') &&
    (source.fetchSelection === undefined ||
      typeof source.fetchSelection === 'function') &&
    (source.fingerprint === undefined ||
      typeof source.fingerprint === 'function') &&
    Array.isArray(source.selection) &&
    validatedSelection(source.selection).length > 0
  );
}

function isAuthority(value: unknown): value is object {
  return (
    (typeof value === 'object' && value !== null) || typeof value === 'function'
  );
}
export function acquisitionAuthority(source: AcquisitionSource): object {
  const value = source.authority;
  if (value === undefined) return source;
  if (!isAuthority(value))
    throw new Error('Source authority must be an object or function.');
  return value;
}

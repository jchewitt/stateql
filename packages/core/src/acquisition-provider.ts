import type { AcquisitionSource } from './acquisition.js';
import { createProviderToken } from './provider.js';
import { validatedSelection } from './state-store.js';

/** Capability validation; results still pass the ordinary acquisition commit boundary. */
export function createAcquisitionSourceToken(
  description = 'Acquisition source',
) {
  return createProviderToken<AcquisitionSource>(
    description,
    (value): value is AcquisitionSource => {
      if (!value || typeof value !== 'object') return false;
      const source = value as Partial<AcquisitionSource>;
      return (
        typeof source.stateAddress === 'string' &&
        source.stateAddress.length > 0 &&
        typeof source.read === 'function' &&
        (source.collection === undefined ||
          typeof source.collection === 'boolean') &&
        (source.fetchSelection === undefined ||
          typeof source.fetchSelection === 'function') &&
        (source.fingerprint === undefined ||
          typeof source.fingerprint === 'function') &&
        Array.isArray(source.selection) &&
        validatedSelection(source.selection).length > 0
      );
    },
  );
}

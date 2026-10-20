import { print } from 'graphql';
import { SAVE_INVOICE } from '../data/operations.js';
import { SaveError, type AccountValue, type EditorTarget } from './draft.js';

/** Same explicit command transport for both demos. No retries or optimistic writes. */
export async function saveAccount(
  target: EditorTarget,
  value: AccountValue,
): Promise<void> {
  let body: unknown;
  let responseOk = false;
  try {
    const response = await fetch('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: print(SAVE_INVOICE),
        operationName: 'SaveInvoice',
        variables: { ...target, accountId: value },
      }),
    });
    responseOk = response.ok;
    body = await response.json();
  } catch {
    throw new SaveError('No reliable command acknowledgement.', 'unknown');
  }
  if (body && typeof body === 'object') {
    if ('errors' in body && Array.isArray(body.errors) && body.errors.length) {
      // Only the fixture's explicit pre-commit rejection codes establish failure.
      const rejected = body.errors.every(
        (error: unknown) =>
          error &&
          typeof error === 'object' &&
          'extensions' in error &&
          error.extensions &&
          typeof error.extensions === 'object' &&
          'code' in error.extensions &&
          ['FIXTURE_REQUEST_FAILURE', 'FIXTURE_SAVE_REJECTED'].includes(
            String(error.extensions.code),
          ),
      );
      throw new SaveError(
        'The server rejected the command.',
        rejected ? 'rejected' : 'unknown',
      );
    }
    if (
      responseOk &&
      'data' in body &&
      body.data &&
      typeof body.data === 'object' &&
      'saveInvoice' in body.data
    ) {
      const saved = body.data.saveInvoice;
      if (
        saved &&
        typeof saved === 'object' &&
        'id' in saved &&
        'tenantId' in saved &&
        saved.id === target.id &&
        saved.tenantId === target.tenantId
      )
        return;
    }
  }
  throw new SaveError('Unrecognized command acknowledgement.', 'unknown');
}

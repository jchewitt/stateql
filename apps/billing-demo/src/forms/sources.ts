import { inject, InjectionToken } from '@angular/core';
import { Apollo } from 'apollo-angular';
import { firstValueFrom } from 'rxjs';
import type { QueryHandle } from '@launch-echo/stateql-core';
import { BILLING_CLIENT } from '../stateql-client';
import { accountMonitor, billingScope } from '../data/stateql-definitions';
import { BILLING_INVOICES, INVOICE_ACCOUNTS } from '../data/operations';
import type { EditorSource, EditorTarget, ServerField } from './draft';
import { saveAccount } from './save-account';

export const EDITOR_SOURCE = new InjectionToken<EditorSource>(
  'Invoice form source',
);
const unavailable = (reason: string): ServerField => ({
  available: false,
  reason,
});

function stateField(handle: QueryHandle, target: EditorTarget): ServerField {
  const snapshot = handle.getSnapshot();
  const record = snapshot.records?.find(
    (row) =>
      row.identity['id'] === target.id &&
      row.identity['tenantId'] === target.tenantId,
  );
  const status = record?.fields.find(
    (field) => field.path.length === 1 && field.path[0] === 'accountId',
  );
  const value = record?.data['accountId'];
  if (
    snapshot.membershipStale ||
    !status?.present ||
    status.stale ||
    status.error ||
    snapshot.resourceError ||
    (value !== null && typeof value !== 'string')
  )
    return unavailable(
      status?.error ??
        snapshot.error ??
        'The invoice field is stale or unavailable. Refresh before saving.',
    );
  return { available: true, value };
}

export function stateqlEditorSource(): EditorSource {
  const client = inject(BILLING_CLIENT);
  return {
    save: saveAccount,
    open(target) {
      const bound = accountMonitor
        .select({ accountId: true })
        .bind({ billing: { tenantId: target.tenantId } }, billingScope);
      const handle = client.watch(bound);
      return {
        read: () => stateField(handle, target),
        subscribe: (notify) => handle.subscribe(notify),
        dispose() {
          handle.dispose();
        },
        async refresh() {
          // Own the entire read independently, even if the editor leaves mid-refresh.
          const owner = client.watch(bound);
          try {
            await owner.invalidate('accountId');
            return stateField(owner, target);
          } finally {
            owner.dispose();
          }
        },
      };
    },
  };
}

export function apolloEditorSource(): EditorSource {
  const apollo = inject(Apollo);
  return {
    save: saveAccount,
    open(target) {
      let latest: ServerField = unavailable('Waiting for server data.');
      const listeners = new Set<() => void>();
      const publish = (field: ServerField) => {
        latest = field;
        for (const listener of listeners) listener();
      };
      const query = apollo.watchQuery({
        query: BILLING_INVOICES,
        variables: { tenantId: target.tenantId },
        fetchPolicy: 'cache-first',
        notifyOnNetworkStatusChange: true,
      });
      const subscription = query.valueChanges.subscribe({
        next(result) {
          if (
            result.loading ||
            result.error ||
            result.dataState !== 'complete'
          ) {
            publish(
              unavailable(result.error?.message ?? 'Refreshing server data.'),
            );
            return;
          }
          const record = result.data?.billing.invoices.find(
            (row) => row.id === target.id && row.tenantId === target.tenantId,
          );
          publish(
            record
              ? { available: true, value: record.accountId }
              : unavailable('Invoice is unavailable.'),
          );
        },
        error(error: unknown) {
          publish(
            unavailable(
              error instanceof Error ? error.message : 'Read failed.',
            ),
          );
        },
      });
      return {
        read: () => latest,
        subscribe(notify) {
          listeners.add(notify);
          return () => listeners.delete(notify);
        },
        dispose() {
          subscription.unsubscribe();
          listeners.clear();
        },
        async refresh() {
          publish(unavailable('Refreshing server data.'));
          try {
            const result = await firstValueFrom(
              apollo.query({
                query: INVOICE_ACCOUNTS,
                variables: { tenantId: target.tenantId },
                fetchPolicy: 'network-only',
              }),
            );
            const record = result.data?.billing.invoices.find(
              (row) => row.id === target.id && row.tenantId === target.tenantId,
            );
            const field: ServerField = record
              ? { available: true, value: record.accountId }
              : unavailable('Invoice is unavailable.');
            publish(field);
            return field;
          } catch (error) {
            publish(unavailable('Refresh failed.'));
            throw error;
          }
        },
      };
    },
  };
}

import { CurrencyPipe } from '@angular/common';
import { Component, computed, effect, inject, input } from '@angular/core';
import { injectStateQuery } from '@tandrove/angular';
import type { InputValue, SnapshotData } from '@tandrove/core';
import type { ResultOf } from '@tandrove/graphql';
import {
  accountMonitor,
  billingInvoices,
  billingScope,
} from './data/tandrove-definitions';
import type { TenantId } from './data/operations';
import { FixtureService } from './fixture.service';
import { BILLING_CLIENT } from './tandrove-client';

type InvoiceData = SnapshotData<ResultOf<typeof billingInvoices>>;

@Component({
  selector: 'tandrove-panel',
  imports: [CurrencyPipe],
  templateUrl: './tandrove-panel.html',
})
export class TandrovePanel {
  readonly tenantId = input.required<TenantId>();
  readonly title = input.required<string>();
  readonly compact = input(false);
  private readonly client = inject(BILLING_CLIENT);
  private readonly fixture = inject(FixtureService);
  readonly query = injectStateQuery(
    () => ({ tenantId: this.tenantId(), compact: this.compact() }),
    ({ tenantId, compact }) =>
      this.client.watch(
        (compact ? accountMonitor : billingInvoices).bind(
          { billing: { tenantId } },
          billingScope,
        ),
      ),
  );
  readonly snapshot = computed(() => {
    const state = this.query.state();
    return state.status === 'active' ? state.snapshot : undefined;
  });
  readonly error = computed(() => {
    const state = this.query.state();
    if (state.status === 'error')
      return state.error instanceof Error
        ? state.error.message
        : 'Unable to open invoices.';
    if (state.status !== 'active') return '';
    return (
      state.snapshot.error ??
      state.snapshot.resourceError ??
      state.snapshot.records
        ?.flatMap((record) => record.fields)
        .find((field) => field.error)?.error ??
      ''
    );
  });

  constructor() {
    effect(() => {
      const snapshot = this.snapshot();
      if (snapshot && !snapshot.fetching) void this.fixture.inspect();
    });
  }

  text(value: InputValue | undefined): string {
    if (value === null) return '(null)';
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : 'Unavailable';
  }
  amount(data: InvoiceData): number | null {
    const value = data.amountCents;
    return typeof value === 'number' ? value / 100 : null;
  }
  userName(data: InvoiceData): string {
    return this.text(data.user?.name);
  }
}

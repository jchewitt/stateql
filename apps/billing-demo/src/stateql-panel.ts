import { CurrencyPipe } from '@angular/common';
import { Component, computed, effect, inject, input } from '@angular/core';
import { injectStateQuery } from '@jchewitt/stateql-angular';
import type { InputValue } from '@jchewitt/stateql-core';
import {
  accountMonitor,
  billingInvoices,
  billingScope,
} from './data/stateql-definitions';
import type { TenantId } from './data/operations';
import { FixtureService } from './fixture.service';
import { BILLING_CLIENT } from './stateql-client';

@Component({
  selector: 'stateql-panel',
  imports: [CurrencyPipe],
  templateUrl: './stateql-panel.html',
})
export class StateQLPanel {
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
  amount(value: InputValue | undefined): number | null {
    return typeof value === 'number' ? value / 100 : null;
  }
  userName(value: InputValue | undefined): string {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'name' in value
    )
      return this.text(value.name);
    return 'Unavailable';
  }
}

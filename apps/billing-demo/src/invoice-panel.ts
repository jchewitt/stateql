import { CurrencyPipe } from '@angular/common';
import { Component, effect, inject, input, signal } from '@angular/core';
import {
  BILLING_INVOICES,
  type Invoice,
  type TenantId,
} from './data/operations';
import { FixtureService } from './fixture.service';
import { BillingService } from './billing.service';

@Component({
  selector: 'invoice-panel',
  imports: [CurrencyPipe],
  template: `
    <section class="panel" [attr.aria-label]="title()">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Independent watcher {{ number() }}</p>
          <h2>{{ title() }}</h2>
        </div>
        <span class="badge">{{ loading() ? 'Fetching' : 'Watching' }}</span>
      </div>
      @if (error()) {
        <p role="alert" class="error">{{ error() }}</p>
      }
      @if (!invoices().length) {
        <p class="muted">
          {{ loading() ? 'Loading invoices…' : 'No invoices loaded.' }}
        </p>
      }
      @for (invoice of invoices(); track invoice.id) {
        <article class="invoice" [attr.data-testid]="'invoice-' + invoice.id">
          <div class="invoice-heading">
            <strong>{{ invoice.id }}</strong
            ><span>{{ invoice.status }}</span>
          </div>
          <div class="account-value" data-testid="account-id">
            {{ invoice.accountId ?? '(null)' }}
          </div>
          @if (compact()) {
            <p class="muted">Shared invoice · tenant {{ invoice.tenantId }}</p>
          } @else {
            <div class="invoice-details">
              <span data-testid="user-name">{{ invoice.user.name }}</span
              ><strong data-testid="amount">{{
                invoice.amountCents / 100 | currency: 'USD'
              }}</strong>
            </div>
          }
        </article>
      }
      <p class="panel-foot">
        Own Apollo watchQuery subscription · shared normalized cache
      </p>
    </section>
  `,
})
export class InvoicePanel {
  readonly tenantId = input.required<TenantId>();
  readonly title = input.required<string>();
  readonly number = input.required<string>();
  readonly compact = input(false);
  readonly invoices = signal<readonly Invoice[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  private readonly billing = inject(BillingService);

  private readonly fixture = inject(FixtureService);

  constructor() {
    effect((cleanup) => {
      const tenantId = this.tenantId();
      this.invoices.set([]);
      this.error.set('');
      this.loading.set(true);
      const subscription = this.billing.apollo
        .watchQuery({
          query: BILLING_INVOICES,
          variables: { tenantId },
          fetchPolicy: 'cache-first',
          notifyOnNetworkStatusChange: true,
        })
        .valueChanges.subscribe({
          next: (result) => {
            this.loading.set(result.loading);
            this.error.set(result.error?.message ?? '');
            if (
              result.dataState === 'complete' &&
              result.data?.billing.tenantId === tenantId
            )
              this.invoices.set(result.data.billing.invoices);
            if (!result.loading) void this.fixture.inspect();
          },
          error: (error: unknown) => {
            this.loading.set(false);
            this.error.set(
              error instanceof Error ? error.message : 'Request failed.',
            );
            void this.fixture.inspect();
          },
        });
      cleanup(() => subscription.unsubscribe());
    });
  }
}

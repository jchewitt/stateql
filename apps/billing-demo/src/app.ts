import { JsonPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { BillingService } from './billing.service';
import { InvoicePanel } from './invoice-panel';
import type { TenantId } from './data/operations';

@Component({
  selector: 'billing-app',
  imports: [InvoicePanel, JsonPipe],
  templateUrl: './app.html',
})
export class App {
  readonly billing = inject(BillingService);
  readonly tenantId = signal<TenantId>('A');
  readonly busy = signal(false);
  readonly message = signal('Two consumers. One initial request.');
  readonly error = signal('');
  readonly showMonitor = signal(true);
  readonly draft = signal('A-custom-ledger');
  readonly delayed = signal(false);

  selectTenant(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'A' || value === 'B') {
      this.tenantId.set(value);
      this.draft.set(`${value}-custom-ledger`);
    }
  }

  setDraft(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  async run(action: () => Promise<void>, success: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await action();
      this.message.set(success);
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Operation failed.',
      );
    } finally {
      this.busy.set(false);
      await this.billing.inspect();
    }
  }

  advance(): void {
    const scope = this.tenantId();
    void this.run(
      () => this.billing.control({ action: 'advance', tenantId: scope }),
      'Server changed account IDs, amounts and names. Cached values are untouched.',
    );
  }
  narrow(): void {
    const scope = this.tenantId();
    void this.run(
      () => this.billing.narrow(scope),
      'Account IDs refreshed. Other cached fields retained.',
    );
  }
  full(): void {
    void this.run(
      () => this.billing.full(),
      'All selected invoice fields refreshed.',
    );
  }
  reverse(): void {
    const scope = this.tenantId();
    void this.run(
      () => this.billing.control({ action: 'reverse', tenantId: scope }),
      'Server order reversed. Refresh to see identity-based merging.',
    );
  }
  fail(): void {
    void this.run(
      () =>
        this.billing.control({
          action: 'configure',
          latencyMs: this.delayed() ? 1000 : 0,
          failNext: 'request',
        }),
      'Next GraphQL request will fail once.',
    );
  }
  delay(): void {
    const enabled = !this.delayed();
    void this.run(
      async () => {
        await this.billing.control({
          action: 'configure',
          latencyMs: enabled ? 1000 : 0,
          failNext: 'none',
        });
        this.delayed.set(enabled);
      },
      enabled
        ? 'Responses delayed by 1 second. Try switching tenants during a refresh.'
        : 'Response delay removed.',
    );
  }
  save(): void {
    const scope = this.tenantId();
    const value = this.draft();
    void this.run(
      () => this.billing.save(scope, value),
      'INV-1 saved, then account IDs refreshed.',
    );
  }
  reset(): void {
    void this.run(async () => {
      await this.billing.reset();
      this.delayed.set(false);
    }, 'Fixtures and Apollo cache reset.');
  }
}

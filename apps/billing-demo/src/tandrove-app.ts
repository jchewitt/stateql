import { BillingEditors } from './forms/billing-editors';
import { Component, inject, signal, viewChild } from '@angular/core';
import type { TenantId } from './data/operations';
import { FixtureService } from './fixture.service';
import { RequestInspector } from './request-inspector';
import { TandrovePanel } from './tandrove-panel';

@Component({
  selector: 'billing-app',
  imports: [TandrovePanel, RequestInspector, BillingEditors],
  templateUrl: './tandrove-app.html',
})
export class TandroveApp {
  readonly fixture = inject(FixtureService);
  readonly tenantId = signal<TenantId>('A');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('Two definitions. Shared invoice state.');
  readonly showMonitor = signal(true);
  readonly delayed = signal(false);
  readonly workspace = viewChild(TandrovePanel);
  private scopeGeneration = 0;

  selectTenant(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'A' || value === 'B') {
      this.scopeGeneration++;
      this.tenantId.set(value);
      this.error.set('');
      this.message.set(`Viewing tenant ${value}.`);
    }
  }

  private async run(
    action: () => Promise<void>,
    success: string,
  ): Promise<void> {
    if (this.busy()) return;
    const generation = this.scopeGeneration;
    this.busy.set(true);
    this.error.set('');
    try {
      await action();
      if (this.scopeGeneration === generation) this.message.set(success);
    } catch (error) {
      if (this.scopeGeneration === generation)
        this.error.set(
          error instanceof Error ? error.message : 'Operation failed.',
        );
    } finally {
      this.busy.set(false);
      await this.fixture.inspect();
    }
  }

  refresh(kind: 'accountId' | 'all' | 'list'): void {
    const query = this.workspace()?.query;
    if (!query) return;
    void this.run(
      () =>
        kind === 'list'
          ? query.refreshList()
          : query.invalidate(kind === 'all' ? undefined : kind),
      kind === 'list'
        ? 'List membership, order and selected fields refreshed.'
        : kind === 'all'
          ? 'Selected fields refreshed; list order retained.'
          : 'Account IDs refreshed. Other cached fields retained.',
    );
  }
  change(action: 'advance' | 'reverse'): void {
    const tenantId = this.tenantId();
    void this.run(
      () => this.fixture.control({ action, tenantId }),
      action === 'advance'
        ? 'Server changed account IDs, amounts and names. Cached values are untouched.'
        : 'Server order reversed. Field refresh keeps cached order; list refresh adopts server order.',
    );
  }
  fail(): void {
    void this.run(
      () =>
        this.fixture.control({
          action: 'configure',
          latencyMs: this.delayed() ? 1000 : 0,
          failNext: 'request',
        }),
      'Next GraphQL request will fail once. Retry manually.',
    );
  }
  remove(): void {
    const tenantId = this.tenantId();
    void this.run(
      () => this.fixture.control({ action: 'remove', tenantId, id: 'INV-1' }),
      'INV-1 removed on the server. Refresh to detect the unavailable record.',
    );
  }
  delay(): void {
    const enabled = !this.delayed();
    void this.run(
      async () => {
        await this.fixture.control({
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
  reset(): void {
    void this.run(async () => {
      await this.fixture.control({ action: 'reset' });
      // A full application reload clears every cached tenant and all query owners.
      window.location.reload();
    }, 'Fixtures reset. Reloading the application.');
  }
}

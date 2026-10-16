import { Injectable, inject, signal } from '@angular/core';
import { Apollo } from 'apollo-angular';
import { firstValueFrom } from 'rxjs';
import {
  INVOICE_ACCOUNTS,
  SAVE_INVOICE,
  type TenantId,
} from './data/operations';

export interface RequestRecord {
  readonly id: number;
  readonly operationName: string;
  readonly query: string;
  readonly variables: Record<string, unknown>;
  readonly fields: readonly string[];
  readonly responseBytes: number;
  readonly errors: readonly string[];
}
interface Inspector {
  count: number;
  records: RequestRecord[];
}

@Injectable({ providedIn: 'root' })
export class BillingService {
  readonly apollo = inject(Apollo);
  readonly requests = signal<Inspector>({ count: 0, records: [] });
  readonly inspectorError = signal('');
  private inspectionGeneration = 0;

  async inspect(): Promise<void> {
    const generation = ++this.inspectionGeneration;
    try {
      const response = await fetch('/__fixture/requests');
      if (!response.ok) throw new Error('Request inspector unavailable.');
      const result = (await response.json()) as Inspector;
      if (generation === this.inspectionGeneration) {
        this.requests.set(result);
        this.inspectorError.set('');
      }
    } catch (error) {
      if (generation === this.inspectionGeneration)
        this.inspectorError.set(
          error instanceof Error ? error.message : 'Inspector failed.',
        );
    }
  }

  async control(body: Record<string, unknown>): Promise<void> {
    const response = await fetch('/__fixture/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(((await response.json()) as { error: string }).error);
  }

  async narrow(tenantId: TenantId): Promise<void> {
    await firstValueFrom(
      this.apollo.query({
        query: INVOICE_ACCOUNTS,
        variables: { tenantId },
        fetchPolicy: 'network-only',
      }),
    );
  }

  async full(): Promise<void> {
    await this.apollo.client.refetchQueries({ include: ['BillingInvoices'] });
  }

  async save(tenantId: TenantId, accountId: string): Promise<void> {
    await firstValueFrom(
      this.apollo.mutate({
        mutation: SAVE_INVOICE,
        variables: { tenantId, id: 'INV-1', accountId },
      }),
    );
    await this.narrow(tenantId);
  }

  async reset(): Promise<void> {
    await this.control({ action: 'reset' });
    await this.apollo.client.resetStore();
  }
}

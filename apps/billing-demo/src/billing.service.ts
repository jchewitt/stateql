import { Injectable, inject } from '@angular/core';
import { FixtureService } from './fixture.service';
import { Apollo } from 'apollo-angular';
import { firstValueFrom } from 'rxjs';
import { INVOICE_ACCOUNTS, type TenantId } from './data/operations';

@Injectable({ providedIn: 'root' })
export class BillingService {
  readonly apollo = inject(Apollo);
  private readonly fixture = inject(FixtureService);

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

  async reset(): Promise<void> {
    await this.fixture.control({ action: 'reset' });
    await this.apollo.client.resetStore();
  }
}

export type TenantId = 'A' | 'B';
export type InvoiceStatus = 'OPEN' | 'PAID';

export interface Invoice {
  id: string;
  tenantId: TenantId;
  accountId: string | null;
  amountCents: number;
  status: InvoiceStatus;
  user: { id: string; tenantId: TenantId; name: string };
}

export interface FixtureSettings {
  latencyMs: number;
  failNext: 'none' | 'request' | 'accountId';
}

function initialInvoices(tenantId: TenantId): Invoice[] {
  return [1, 2].map((number) => ({
    id: `INV-${number}`,
    tenantId,
    accountId: `${tenantId}-ledger-${number}-v1`,
    amountCents: (tenantId === 'A' ? 12000 : 45000) + number * 500,
    status: number === 1 ? 'OPEN' : 'PAID',
    user: {
      id: `USER-${number}`,
      tenantId,
      name: `${tenantId === 'A' ? 'Ada' : 'Grace'} ${number}`,
    },
  }));
}

export function tenant(value: unknown): TenantId {
  if (value !== 'A' && value !== 'B')
    throw new Error('Unknown tenant; use A or B.');
  return value;
}

/** Each server/test owns its fixture. No process-global data or timers. */
export class BillingFixture {
  private invoices: Record<TenantId, Invoice[]> = {
    A: initialInvoices('A'),
    B: initialInvoices('B'),
  };
  private revisions = { A: 1, B: 1 };
  private settings: FixtureSettings = { latencyMs: 0, failNext: 'none' };

  snapshot(): Record<TenantId, Invoice[]> {
    return structuredClone(this.invoices);
  }

  reset(): void {
    this.invoices = { A: initialInvoices('A'), B: initialInvoices('B') };
    this.revisions = { A: 1, B: 1 };
    this.settings = { latencyMs: 0, failNext: 'none' };
  }

  configure(settings: FixtureSettings): void {
    if (
      !Number.isInteger(settings.latencyMs) ||
      settings.latencyMs < 0 ||
      settings.latencyMs > 3000
    ) {
      throw new Error('latencyMs must be an integer from 0 to 3000.');
    }
    if (!['none', 'request', 'accountId'].includes(settings.failNext))
      throw new Error('Invalid failure mode.');
    this.settings = { ...settings };
  }

  takeSettings(): FixtureSettings {
    const result = { ...this.settings };
    this.settings.failNext = 'none';
    return result;
  }

  advance(tenantId: TenantId): void {
    const revision = ++this.revisions[tenantId];
    for (const invoice of this.invoices[tenantId]) {
      invoice.accountId = `${tenantId}-ledger-${invoice.id.slice(4)}-v${revision}`;
      invoice.amountCents += 1000;
      invoice.user.name = `${tenantId === 'A' ? 'Ada' : 'Grace'} ${invoice.id.slice(4)} v${revision}`;
    }
  }

  reverse(tenantId: TenantId): void {
    this.invoices[tenantId].reverse();
  }

  remove(tenantId: TenantId, id: string): void {
    if (!this.invoices[tenantId].some((invoice) => invoice.id === id))
      throw new Error('Invoice not found in this tenant.');
    this.invoices[tenantId] = this.invoices[tenantId].filter(
      (invoice) => invoice.id !== id,
    );
  }

  save(tenantId: TenantId, id: string, accountId: string | null): Invoice {
    const invoice = this.invoices[tenantId].find((item) => item.id === id);
    if (!invoice) throw new Error('Invoice not found in this tenant.');
    if (accountId !== null && (accountId.length === 0 || accountId.length > 80))
      throw new Error('accountId must contain 1–80 characters.');
    invoice.accountId = accountId;
    return structuredClone(invoice);
  }
}

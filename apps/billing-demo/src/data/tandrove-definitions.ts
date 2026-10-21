import { schema } from './generated/billing.js';

/** Central domain definition: the only source of the workspace's field selection. */
export const billingInvoices = schema
  .field('billing')
  .field('invoices')
  .select({
    accountId: true,
    amountCents: true,
    status: true,
    user: { select: { name: true } },
  });

/** Feature composition reuses the same resource, arguments and identity rules. */
export const accountMonitor = billingInvoices
  .select({ accountId: true })
  .extend({ status: true });

export const billingScope = Object.freeze({
  source: 'billing-api',
  scope: 'local-demo',
});

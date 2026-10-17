import { schema } from './generated/billing.js';

const invoices = schema
  .field('billing')
  .field('invoices')
  .select({
    accountId: true,
    amountCents: true,
    user: { select: { name: true } },
  });
const bound = invoices.bind(
  { billing: { tenantId: 'A' } },
  { source: 'billing-api', scope: 'local-demo' },
);
const full = bound.prepare();
const narrow = bound.prepare('accountId');
console.log('Full selection:\n' + full.query);
console.log('Account ID refresh:\n' + narrow.query);
console.log('Variables:', narrow.variables);
console.log('Same state address:', full.stateAddress === narrow.stateAddress);
console.log(
  'Different request fingerprint:',
  full.fingerprint !== narrow.fingerprint,
);
console.log('This example plans requests; cache execution arrives in P3.');

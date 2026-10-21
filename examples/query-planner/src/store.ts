import { StateStore, type StateChange } from '@launch-echo/stateql-core';
import { schema } from './generated/billing.js';

const base = schema
  .field('billing')
  .field('invoices')
  .select({ accountId: true });
const extended = base.extend({ amountCents: true });
const variables = { billing: { tenantId: 'A' } };
const scope = { source: 'billing-api', scope: 'local-demo' };
const first = base.bind(variables, scope);
const second = extended.bind(variables, scope);
const store = new StateStore();
const summary = store.watch(first.stateAddress, first.selection);
const details = store.watch(second.stateAddress, second.selection);
const record = { tenantId: 'A', id: 'invoice-1' };
const fieldWrite = (name: string, value: string | number): StateChange => ({
  kind: 'write',
  record,
  path: [{ name, arguments: {} }],
  value,
});
const offSummary = summary.subscribe(() =>
  console.log('Summary:', summary.getSnapshot().records?.[0]?.data),
);
const offDetails = details.subscribe(() =>
  console.log('Details:', details.getSnapshot().records?.[0]?.data),
);

// Decoded changes are supplied directly until the execution/decoding milestone.
store.commit(first.stateAddress, [
  { kind: 'membership', records: [record] },
  fieldWrite('accountId', 'account-old'),
  fieldWrite('amountCents', 1200),
]);
const unchangedSummary = summary.getSnapshot();
console.log('Update amount; only the details consumer should notify:');
store.commit(first.stateAddress, [fieldWrite('amountCents', 1400)]);
console.log(
  'Summary snapshot unchanged:',
  summary.getSnapshot() === unchangedSummary,
);
console.log('Update account ID; both consumers should notify:');
store.commit(first.stateAddress, [fieldWrite('accountId', 'account-new')]);
offSummary();
offDetails();
summary.dispose();
details.dispose();
store.dispose();

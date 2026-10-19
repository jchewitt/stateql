import { schema } from '../../../examples/query-planner/src/generated/billing.js';
import type { ResultOf, Selection } from '../src/index.js';
import { createGraphQLClient } from '../src/index.js';
import type { GeneratedTypes } from '../../../examples/query-planner/src/generated/billing.js';

const resource = schema.field('billing').field('invoices');
const base = resource.select({
  accountId: { as: 'ledger' },
  user: { select: { name: true } },
});
const extended = base.extend({
  amountCents: true,
  user: { select: { id: true } },
});
declare const result: ResultOf<typeof extended>;
const ledger: string | null = result.ledger;
const amount: number = result.amountCents;
const name: string = result.user.name;
const id: string = result.user.id;
void [ledger, amount, name, id];
// @ts-expect-error alias replaces the result key
result.accountId;
const parent: ResultOf<typeof base> = {
  ledger: null,
  // @ts-expect-error extensions do not widen the parent
  amountCents: 1,
  user: { name: 'x' },
};
void parent;
// @ts-expect-error readonly result
result.user.name = 'mutated';
// @ts-expect-error unknown path
schema.field('missing');
// @ts-expect-error scalar is not a resource
resource.field('accountId');
// @ts-expect-error unknown selected field
resource.select({ unknown: true });
// @ts-expect-error unknown nested selected field
resource.select({ user: { select: { unknown: true } } });
// @ts-expect-error unknown nested arguments
resource.select({ user: { args: { unknown: 1 }, select: { name: true } } });
// @ts-expect-error object requires a nested selection
resource.select({ user: true });
// @ts-expect-error cannot use unsupported selection options
resource.select({ accountId: { skip: true } });
const scope = { source: 'billing', scope: 'session' };
// @ts-expect-error ancestor argument is required
base.bind({}, scope);
// @ts-expect-error wrong ancestor argument type
base.bind({ billing: { tenantId: false } }, scope);
base.bind(
  // @ts-expect-error invalid enum
  { billing: { tenantId: 'A' }, 'billing.invoices': { status: 'UNKNOWN' } },
  scope,
);
// @ts-expect-error unknown argument path
base.bind({ billing: { tenantId: 'A' }, other: {} }, scope);
// @ts-expect-error unknown argument name
base.bind({ billing: { tenantId: 'A', other: 1 } }, scope);
const bound = base.bind(
  { billing: { tenantId: 'A' }, 'billing.invoices': { status: null } },
  scope,
);
bound.prepare('ledger');
bound.prepare('user.name');
bound.prepare('user');
const client = createGraphQLClient({ endpoint: 'http://localhost/graphql' });
const handle = client.watch(bound);
void handle.invalidate('ledger');
void handle.invalidate('user.name', { refetch: 'none' });
void handle.refresh('user');
void handle.invalidate();
// @ts-expect-error use the selected alias, not the source name
void handle.invalidate('accountId');
// @ts-expect-error the parent definition was not widened by its extension
void handle.refresh('amountCents');
// @ts-expect-error unknown nested field
void handle.invalidate('user.unknown');
// @ts-expect-error invalid policy
void handle.invalidate('ledger', { refetch: 'always' });
// @ts-expect-error unknown selected refresh field
bound.prepare('amountCents');
// @ts-expect-error canonical name hidden by alias
bound.prepare('accountId');
// @ts-expect-error unknown nested refresh field
bound.prepare('user.id');

declare const flag: boolean;
const wholeConditional = resource.select(
  flag ? { id: true } : { accountId: true },
);
declare const wholeResult: ResultOf<typeof wholeConditional>;
// @ts-expect-error whole selection alternative may omit id
const wholeId: string = wholeResult.id;
const wholeExtension = resource
  .select({ amountCents: true })
  .extend(flag ? { id: true } : { accountId: true });
declare const wholeExtendedResult: ResultOf<typeof wholeExtension>;
const commonAmount: number = wholeExtendedResult.amountCents;
// @ts-expect-error whole extension alternative may omit id
const wholeExtendedId: string = wholeExtendedResult.id;
void [wholeId, commonAmount, wholeExtendedId];
const conditionalAlias = resource.select({
  accountId: flag ? { as: 'ledger' as const } : (true as const),
});
declare const aliasResult: ResultOf<typeof conditionalAlias>;
const possibleLedger: string | null | undefined = aliasResult.ledger;
// @ts-expect-error conditional alias can omit canonical key
const definiteAccount: string | null = aliasResult.accountId;
// @ts-expect-error conditional alias can omit alias key
const definiteLedger: string | null = aliasResult.ledger;
const aliasChoices = resource.select({
  accountId: { as: flag ? ('first' as const) : ('second' as const) },
});
declare const choiceResult: ResultOf<typeof aliasChoices>;
// @ts-expect-error only one alias is selected at runtime
const definiteFirst: string | null = choiceResult.first;
void [possibleLedger, definiteAccount, definiteLedger, definiteFirst];
const conditional = resource.select({
  id: true,
  ...(flag ? { amountCents: true as const } : {}),
});
declare const conditionalResult: ResultOf<typeof conditional>;
const optionalAmount: number | undefined = conditionalResult.amountCents;
// @ts-expect-error conditional selection can be absent
const requiredAmount: number = conditionalResult.amountCents;
const conditionalExtension = resource
  .select({ id: true })
  .extend({ ...(flag ? { amountCents: true as const } : {}) });
declare const extensionResult: ResultOf<typeof conditionalExtension>;
const requiredId: string = extensionResult.id;
// @ts-expect-error conditional extension can be absent
const extensionAmount: number = extensionResult.amountCents;
declare const broad: Selection<GeneratedTypes, 'Invoice'>;
const dynamic = resource.select(broad);
declare const dynamicResult: ResultOf<typeof dynamic>;
// @ts-expect-error broad selections cannot guarantee field presence
const broadAmount: number = dynamicResult.amountCents;
const conditionalNested = resource
  .select({ user: { select: { name: true } } })
  .extend({ ...(flag ? { user: { select: { id: true as const } } } : {}) });
declare const nestedResult: ResultOf<typeof conditionalNested>;
const requiredName: string = nestedResult.user.name;
// @ts-expect-error optional nested extension cannot guarantee nested ID
const nestedId: string = nestedResult.user.id;
void [
  optionalAmount,
  requiredAmount,
  requiredId,
  extensionAmount,
  broadAmount,
  requiredName,
  nestedId,
];

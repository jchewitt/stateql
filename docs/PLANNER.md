# Typed operation planner

P2 implements definition and operation planning. P3 will execute operations and apply responses to shared state. `prepare('accountId')` currently returns a request plan; it does not invalidate or fetch anything.

## Run and regenerate

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo:planner
```

`pnpm generate:billing` regenerates `examples/query-planner/src/generated/billing.ts` from the fixture SDL and explicit identity configuration. `pnpm check` builds workspace dependencies before checking generated-file drift, types, execution tests, and packed consumers. Run `pnpm build` before standalone type checks/tests in a fresh checkout.

`generateSchemaModule` is exported from `@jchewitt/stateql-graphql/codegen`. Generated types and runtime schema come from the same SDL; applications do not maintain separate query documents or query-key mappings. The prototype embeds SDL and validates it at runtime. Compact generated metadata is a possible later optimization, not an implemented feature.

## One definition, different request coverage

```ts
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
  { source: 'billing-api', scope: 'session-1' },
);
const full = bound.prepare();
const narrow = bound.prepare('accountId');
// full.stateAddress === narrow.stateAddress
// full.fingerprint !== narrow.fingerprint
```

The narrow request selects `accountId` plus configured identity/context fields and `__typename`. Ancestor arguments remain intact. Arguments become typed GraphQL variables. The generated AST is validated against the schema before return. `responsePath` identifies the resource within the wire response; `selection` identifies requested application fields separately from injected identity coverage.

State addresses include source, caller-provided scope, canonical resource path, and coerced arguments. Selection and aliases do not participate. Full argument paths such as `billing.invoices` prevent repeated field names in different ancestors from colliding. Default values and GraphQL input coercion are applied before addressing; omitted nullable arguments and explicit null remain distinct. P3 will attach these addresses to actual stored state.

## Composition and types

Definitions are immutable. `.extend(...)` adds fields and recursively composes nested selections. `.select(...)` narrows an existing definition and checks compatible subset membership at runtime. Both use the same schema-checked selection shape. Incompatible alias/argument overrides fail explicitly. A resource definition supports one occurrence of each canonical field.

`{ accountId: { as: 'ledger' } }` changes the projected response key and the refresh path to `ledger`, while `bound.address('ledger')` still addresses canonical `accountId`. Field addresses include field arguments and may include caller-supplied record identity. They are not a global entity-normalization scheme.

`ResultOf<typeof definition>` describes one selected object projection, including nested nullability, arrays, aliases, and optional conditional selections. It does not describe the full HTTP/GraphQL response envelope or resource-path list wrappers. It is a compile-time contract; the [acquisition runtime](ACQUISITION.md) has a strict decoder for its documented subset and currently exposes JSON snapshots. Dynamic selections may permit targets in TypeScript that are absent in a particular instance; runtime preparation and handle operations reject absent targets.

## Supported boundary

- Query operations, built-in scalars, enums, ordinary input objects, defaults, nested objects, and lists.
- A query root named `Query`; paths cannot traverse through list items (use nested selections).
- Object lists require configured non-null scalar/enum identity fields. The billing fixture uses tenant-aware identities.
- Custom scalars, interfaces/unions, OneOf inputs, custom directives, and selection directives are unsupported. Unsupported schema features fail explicitly.
- The planner itself does not execute operations. The [acquisition runtime](ACQUISITION.md) adds HTTP execution, strict decoding, shared caching, subscriptions, and selective refresh. The [Angular adapter](ANGULAR.md) and both billing demo modes are implemented and [compared](COMPARISON.md). Mutation planning and polling remain planned.

The GraphQL package stays private. Release readiness and npm ownership remain unchanged. This milestone demonstrates shared definition/address generation; it does not yet establish an advantage over Apollo's working cache behavior.

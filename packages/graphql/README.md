# StateQL GraphQL source

Experimental GraphQL source implementing schema-generated TypeScript definitions, immutable selection composition, argument validation/coercion, canonical addressing, and GraphQL AST generation. Operations include required ancestors, variables, and configured identity fields, and are validated against the supplied schema.

It consumes portable selections from core. A validated acquisition decoder and default HTTP client connect the planner to shared storage. Located GraphQL execution errors are mapped through aliases, list identities, and schema nullability into field failures or structural nulls; valid sibling fields can commit. See the [acquisition guide](https://github.com/jchewitt/stateql/blob/main/docs/ACQUISITION.md) for executable usage and remaining reconciliation limits, and the [planner guide](https://github.com/jchewitt/stateql/blob/main/docs/PLANNER.md) for definition semantics.

## Install and first query

The initial release candidate is `0.1.0-alpha.0`. Once published, install matching versions:

```sh
npm install @launch-echo/stateql-core@0.1.0-alpha.0 @launch-echo/stateql-graphql@0.1.0-alpha.0 graphql@^16.14.2
```

This native JavaScript example expects an ordinary GraphQL endpoint matching the supplied SDL:

```js
import {
  createGraphQLClient,
  createSchema,
} from '@launch-echo/stateql-graphql';

const schema = createSchema(
  'type Query { invoice(id: ID!): Invoice } type Invoice { id: ID! accountId: ID! amount: Float! }',
  { identities: { Invoice: ['id'] } },
);
const invoice = schema
  .field('invoice')
  .select({ accountId: true, amount: true });
const client = createGraphQLClient({ endpoint: '/graphql' });
const view = client.watch(
  invoice.bind(
    { invoice: { id: 'I1' } },
    { source: 'billing', scope: 'current-session' },
  ),
);
const unsubscribe = view.subscribe(() => console.log(view.getSnapshot()));
try {
  await view.ready;
  await view.invalidate('accountId'); // Fetch/replace accountId; keep amount cached.
} finally {
  unsubscribe();
  view.dispose();
  client.dispose();
}
```

Use an absolute endpoint URL in Node. The default transport requires native `fetch`/`AbortController`; Node 22.14+ and Node 24 are tested, as is Chromium through the Angular demo. The GraphQL peer range is `^16.14.2`. ESM JavaScript works without TypeScript or code generation. No StateQL server companion, Redis or socket service is needed.

The alpha supports singleton objects, keyed top-level resource lists and nested objects; nested object lists, unions/interfaces, pagination and global entity normalization are not implemented. Snapshot data currently exposes JSON values rather than a fully inferred result type. Extension contracts remain provisional; review alpha changelogs for migrations and keep StateQL packages on matching versions. See [release status](https://github.com/jchewitt/stateql/blob/main/docs/RELEASING.md) before installing a version not yet published.

Native JavaScript consumers can call `createSchema(sdl, options)` with runtime SDL and configured identities. Names and arguments are validated at runtime; generated TypeScript models are optional. Explicit `createSchema<Model>(sdl, options)` retains strict schema-aware editor checks. Both use the same JavaScript runtime, and neither needs a TypeScript loader. See [runnable vanilla examples and typing limits](https://github.com/jchewitt/stateql/blob/main/docs/VANILLA.md).

An injected `GraphQLTransport` receives the prepared operation and an optional `GraphQLTransportContext` containing a native `AbortSignal`. The client supplies this context for every acquisition; custom transports should forward the signal to their network implementation. The default HTTP transport forwards it to `fetch`. Core uses a portable cancellation interface and imports no browser globals. See the [concurrency contract](https://github.com/jchewitt/stateql/blob/main/docs/CONCURRENCY.md).

The assembled client defaults to two retries for classified transient transport failures, with jittered exponential backoff and native timers. Configure `retry`, pass `retry: false` to disable, or inject `scheduler` for deterministic control. Custom transports opt in by throwing `ReadTransportError` from core; ordinary exceptions, malformed JSON, and GraphQL errors do not retry. See [classification, terminal field errors, and limits](https://github.com/jchewitt/stateql/blob/main/docs/RETRIES.md).

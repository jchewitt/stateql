# Vanilla consumers and adapter experiments

P3.8 exercises the library without a UI framework. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm demo:vanilla
pnpm demo:typescript
pnpm demo:adapters
pnpm demo:deadline
```

These deterministic examples use in-process fixtures. `pnpm demo:acquire` is the HTTP example; `pnpm demo` runs both Tandrove and Apollo Angular views.

The [deadline example](../examples/vanilla/src/deadline.mjs) configures a named request-policy group and two consumers sharing one timed request. A controlled scheduler triggers the deadline; both consumers settle and the GraphQL transport signal aborts. It runs in isolated installed-package acceptance too. See [policy and lifetime details](DEADLINES.md).

## JavaScript is a supported consumer

Tandrove is implemented in TypeScript and ships compiled ESM JavaScript with declaration files. Consuming the packages does not require TypeScript, a TypeScript loader, or generated schema types. Building this repository does use TypeScript. CommonJS packaging and a React adapter are not implemented.

The [native JavaScript example](../examples/vanilla/src/javascript.mjs) uses runtime SDL:

```js
const schema = createSchema(sdl, { identities });
const invoices = schema
  .field('billing')
  .field('invoices')
  .select({
    accountId: { as: 'ledger' },
    amount: true,
  });
const client = createGraphQLClient({
  endpoint: 'http://localhost:4100/graphql',
});
const view = client.watch(
  invoices.bind(
    { billing: { tenantId: 'A' } },
    { source: 'billing-api', scope: 'session-A' },
  ),
);
await view.ready;
await view.invalidate('ledger');
client.dispose();
```

Runtime SDL and identity configuration still supply the schema knowledge needed to validate names, arguments, selections, and generated operations. Optional code generation supplies stronger editor/type checking; it is not necessary for execution. Dynamic `createSchema(sdl)` accepts string field names and checks schema-dependent mistakes at runtime. The example also runs with TypeScript's `checkJs` enabled to verify JavaScript editor compatibility.

The [TypeScript example](../examples/vanilla/src/typescript.ts) uses the same implementation with `createSchema<Model>(sdl, options)`. Explicit or generated schema models provide selection, argument, and target-path checks. Its compile-only negative cases verify that this stricter overload remains strict. Runtime snapshots currently expose immutable JSON projections, not schema-inferred application envelopes.

The JavaScript scenario verifies shared initial acquisition, a feature extension that fetches only missing fields, alias invalidation that preserves cached amounts, nested argument-bearing selections, and runtime rejection of invalid names/arguments. The package check installs actual core and GraphQL tarballs outside the repository, confirms TypeScript is absent from that consumer, and executes both JavaScript examples and the compiled TypeScript example with native Node. It then uses the repository's compiler to check declarations and JavaScript editor types against those installed packages.

## Whole-resource and event adapters

The [adapter example](../examples/vanilla/src/adapters.mjs) imports portable core directly. Its source expands requested coverage through `fetchSelection`; a narrow invalidation therefore fetches the whole fixture payload while committing only the requested field and necessary structural changes. It demonstrates the boundary a future REST adapter could use, without claiming bandwidth savings from a server that cannot select fields.

A separate fake event fixture maps a declared event into `AcquisitionClient.ingest(source, patch)`. The event binding supplies the scoped source, configured record identity, canonical selection, and decoded field values. All interested consumers of that state address update through the same validation, generation filtering, atomic commit, and notification path as reads. A different session scope stays isolated.

This provisional adapter-facing ingress has deliberate limits:

- The client must already know the scoped resource, have an active owner, and have acquired non-null array membership. Events cannot establish membership.
- A nonempty patch names only existing records and fields within the supplied source's selection. It cannot insert, remove, reorder, or replace resource membership.
- All selected fields must be supplied for each patched record, including required object structure. Explicit field errors are accepted and retain values according to normal reconciliation rules; omissions, unknown/duplicate identities, invalid selections, and malformed values reject the entire patch before advancing any generation.
- Records omitted from a patch are untouched. The patch does not make them missing or mark membership stale. Object nulls and changed embedded identities still clear obsolete descendants.
- A validated patch advances local ordering and records barriers for its changed records/fields before notifying observers. An older response can still update unaffected fields and records, but cannot overwrite the patch. Unsafe older membership replacements are rejected conservatively.
- Adapters own connection cleanup and event decoding. The example explicitly disconnects its listener; core rejects ingestion after client disposal or when no active owner remains. Scoped addresses provide routing separation, not authentication or authorization.

The example holds an older full read, applies an event, and then releases the read. The event value survives, an unaffected amount can still update, and the older forced operation reports `AcquisitionSupersededError`. Focused tests also cover atomic rejection, structural changes, shared errors, reentrant listeners, and pushes during retry backoff.

These are local arrival/request generations. They cannot determine whether a pushed server value is newer than an HTTP value across transports. An overlapping push can conservatively stop an older retry chain. Authoritative revisions, duplicate detection, reconnect/gap recovery, real WebSocket/SSE delivery, invalidation tokens, server adapters, and offline replay remain E1–E4 work. The fake event fixture does not implement those protocols.

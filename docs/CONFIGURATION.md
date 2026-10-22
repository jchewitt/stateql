# Provider and resource configuration

B5 adds provider assignment to the [B4 registration and ownership contract](PROVIDERS.md). Both are implemented in this checkout and queued for a batched release; alpha.5 and earlier do not include them. The default `createGraphQLClient({ endpoint })` remains synchronous and requires no provider registry.

## Register infrastructure, then assign it

```js
import { createProviderScope, provide } from '@tandrove/core';
import {
  createGraphQLClient,
  createGraphQLTransportToken,
  httpTransport,
} from '@tandrove/graphql';

const http = createGraphQLTransportToken('application HTTP');
const infrastructure = createProviderScope([
  provide(http, {
    useFactory: async () =>
      httpTransport({ endpoint: 'https://example.com/graphql' }),
  }),
]);
let client;
try {
  await infrastructure.resolve(http);
  client = createGraphQLClient({
    providerScope: infrastructure,
    providers: { transport: http },
    requestPolicy: { retentionMs: 60_000 },
    resourceGroups: {
      billing: { requestPolicy: { freshness: { staleTimeMs: 30_000 } } },
      disabled: { providers: { transport: false } },
    },
  });
  // Given your canonical bound GraphQL definition:
  // const view = client.watch(invoices, { group: 'billing' });
  // A resource override can re-enable a disabled inherited transport:
  // const view = client.watch(invoices, {
  //   group: 'disabled', providers: { transport: http },
  // });
} finally {
  client?.dispose();
  await infrastructure.dispose();
}
```

Registration alone does not assign a provider. Resolve asynchronous factories explicitly during bootstrap; assignment uses ready-only `get()`, never `resolve()`. Missing registrations, unready providers, disabled required capabilities and incompatible values throw synchronously when binding a resource, before attaching ownership or issuing reads. Unused registered factories stay dormant. Supplied values require no asynchronous bootstrap.

Each client captures global configuration and its group map at construction. Each `watch()` captures its effective resource binding. Later changes to the configuration objects cannot change existing bindings. Provider values themselves remain application-owned objects; the configuration layer does not freeze them.

## Precedence and groups

Resolve each capability and each policy field as global defaults → one named resource group → resource override. Omission inherits; `false` disables. A token at a more specific level re-enables that capability. An empty `providers` or `requestPolicy` object inherits its parent. Unknown capabilities, resource options, group options and group names are rejected.

`resourceGroups` unifies provider assignment and timing policies. Existing `requestPolicyGroups` remains supported for policy-only groups. Both use the same `group` selector, but declaring the same name in both maps is an error; move that group's policy into `resourceGroups[name].requestPolicy`. Groups and tokens never enter state addresses. Different group labels that resolve to identical behavior can share cached work.

GraphQL supports the `transport` capability. An omitted assignment uses the client's direct `transport` or `endpoint` fallback. A provider-only client needs neither; every watched resource must resolve a usable transport. Explicit `false` rejects the watch, even if a direct fallback exists. It does not create a cache-only/offline handle or stop already-existing handles. Eviction, persistence, offline recovery and connectivity controls remain separate concepts.

Retry settings remain client-wide. Deadline, freshness and retention policies are shared per cached resource; consumers must agree on their resolved values. A group's name cannot create competing policies for already-shared work. No streaming, persistence, replay or command capability is accepted before its implementation exists.

B6's `requestPolicy.polling.everyMs` is an owner default, so it can differ between consumers sharing cached state. It follows the same precedence and disable rules, but starts no timer until `handle.poll()` is called. Identical active selections share the fastest cadence. See [polling behavior and ownership](POLLING.md); B6 is pending a batched release.

## Custom core sources

Core supports `providers: { acquisition: sourceToken }` using `createAcquisitionSourceToken()`. With an assignment, `AcquisitionClient.watch()` accepts a descriptor containing `stateAddress`, `selection`, and optional `collection`; it needs no dummy `read()` callback. Without an assignment, continue passing an ordinary `AcquisitionSource`. Explicit acquisition `false` prevents fallback to that source.

```js
const native = new AcquisitionClient({
  providerScope: infrastructure,
  resourceGroups: {
    invoices: { providers: { acquisition: invoicesSourceToken } },
  },
});
const view = native.watch(
  {
    stateAddress: invoicesSource.stateAddress,
    selection: invoicesSource.selection,
    collection: true,
  },
  { group: 'invoices' },
);
```

This example assumes a registered application-defined source token and bound source. A source provider is already bound to one canonical address; assigning it globally serves only that resource. It is not a general adapter that routes arbitrary addresses. A GraphQL transport, by contrast, can serve many resources. Multi-resource custom acquisition adapters remain future work, without adding a second route/key mapping language now.

The assigned source must match the descriptor's address and collection semantics and contain its selection, including field arguments and response aliases. A narrower descriptor observes/commits only its requested fields. Whole-resource providers can still advertise broader `fetchSelection()` coverage inside their full source selection; extra fetched siblings are validated but not committed as ordinary writes. Every result and patch follows the existing validation/generation/reconciliation path.

## Shared authority and lifetime

Within one client, a cached address has one authority. GraphQL uses the resolved transport function's identity. Two tokens resolving to the same function share that authority; different functions cannot silently replace it. Core uses the selected source object's identity by default. Distinct instances with the same prototype `read()` method are still distinct authorities.

Equivalent custom source wrappers can set `authority` to one shared object/function. Reuse that authority across selection wrappers and patch ingress. `ingest(source, patch)` checks it too; a different source cannot overwrite an existing resource through the local patch path. This is an application declaration of equivalence, not an authentication mechanism.

Authority and effective timing policy are bound for the whole cached scope lifetime, including inactive retention. Rejected watches do not extend its retention timer. Whole-resource eviction releases the binding, so later acquisition may use a new authority; retained data from the previous authority is discarded. Active owners prevent eviction. A resource/handle/client disposal never closes its borrowed provider scope or another client's infrastructure.

Keep tenant, authorization, source and schema isolation in canonical definition scopes. Tokens and groups are not security boundaries. Mutating an endpoint, credentials or behavior hidden inside the same source/transport object cannot be detected by identity comparison; use a distinct canonical scope or a new client when that changes the authority. Dispose clients before their infrastructure scope, as in B4.

### Migration from alpha.5

Normal assembled GraphQL usage is unchanged. Custom core code that repeatedly creates equivalent source objects for one address should reuse a source instance or add one stable `authority` object to those wrappers. Do not assign a universal authority merely to suppress conflicts between different backends. `ResourceConfiguration<Capabilities>` exposes the same portable capture/resolution primitive for future concrete integrations; it has no provider initialization, ownership, dependency injection or network behavior of its own.

Run `pnpm demo:providers` after building for executable JavaScript using GraphQL and custom-source assignments. Installed-package checks execute and type-check that example. Core/GraphQL tests cover inheritance, disabling, alias tokens, policy conflicts, readiness, authority isolation, malformed results and lifecycle behavior. The default Angular client factory accepts the configured synchronous GraphQL client without a new framework adapter.

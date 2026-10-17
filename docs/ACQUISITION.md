# Automatic acquisition

P3.2 connects the planner to the shared store through a portable acquisition boundary. The GraphQL package offers an HTTP default and an injectable transport for tests or alternate execution environments. Core still imports no GraphQL, framework, HTTP, browser, Node, or timer API.

```ts
const client = createGraphQLClient({
  endpoint: 'http://127.0.0.1:4100/graphql',
});
const handle = client.watch(invoices.bind(variables, scope));
const unsubscribe = handle.subscribe(() => render(handle.getSnapshot()));
await handle.ready;
// Later, retry failed acquisition or fill missing fields; fresh fields are reused.
await handle.ensure();
unsubscribe();
handle.dispose();
client.dispose();
```

Supply an absolute HTTP(S) URL, for example `http://127.0.0.1:4100/graphql`. Dynamic headers can be supplied with `headers: () => ({ authorization: ... })`; credentials are not placed in cache addresses. A client should belong to one session/authorization context. Dispose it when that context changes. Each client has its own store.

Run `pnpm check` then `pnpm demo:acquire`. This self-contained demo starts the fixture on an ephemeral port, loads two identical consumers, extends one view with `amountCents`, prints the actual two HTTP requests, and disposes the client/server. The second request contains the additional field and required identity/context; it does not request the cached account ID. The summary retains its snapshot reference.

## Acquisition and observations

`watch` starts acquisition without waiting for a listener. `getSnapshot` is side-effect-free. `ready` rejects on initial failure; an internal rejection handler prevents unhandled errors when UI code observes snapshot errors instead. `ensure` is an explicit promise-returning retry/fill operation, not a forced refetch. There are no automatic retry loops yet.

Reads are serialized within each resource address. After earlier work settles, each queued consumer recomputes its missing/stale/error coverage. Identical consumers therefore reuse the first successful acquisition, while extensions only fetch additional fields. Different addresses can progress independently. This deliberately precedes the general concurrent-request/generation scheduler planned in P3.6.

Snapshots currently expose the store's immutable `records`, `complete`, `stale`, and `fetching` plus a handle-level acquisition `error`. That error describes this handle's last failed attempt and is cleared by its next `ensure`; another handle may fill the shared cache without clearing it. They are JSON projections, not yet schema-inferred application data envelopes. Record identities and aliases are preserved. Known empty membership is reused. Listener failures go to optional `onListenerError`, never into transport retries; without a handler they are ignored. Error reporting callbacks cannot disrupt acquisition.

Disposing a handle removes its subscriptions and freezes its readable snapshot. Another owner can still use the in-progress acquisition. Client disposal, or having no active owners when a response settles, prevents its commit. A new owner joining before completion can reuse that in-flight read; ownership epochs are deferred to P3.6. Underlying HTTP cancellation, timeouts, timed retention, and general field generations are not implemented in this increment; transports can remain in flight until they settle. Inactive data is retained until client disposal.

## Decoder and reconciliation boundary

The initial read establishes membership. Subsequent field acquisition merges by configured record identity and preserves order. A different membership set fails without inserting partial records or deleting existing records. Explicit membership refresh/reconciliation follows in P3.4.

The GraphQL decoder validates response shapes, `__typename`, identities, scalar values, selected field presence, and non-null constraints before returning changes. Nullable embedded objects and scalar lists are supported. Omitted fields, any GraphQL errors, malformed identities, null resource/ancestors, and nested object lists fail explicitly. Failed GraphQL decoding commits no partial response; existing values remain available. P3.5 will add protocol-aware partial-error and structural-null reconciliation. The portable core can retain successful writes from a source that omits fields, but reports incomplete acquisition and requests the remaining fields on the next ensure.

Source writes must stay inside requested coverage. Source callbacks return decoded records; they never receive direct access to the store. An HTTP transport receives the prepared operation and returns the GraphQL envelope. GraphQL schema logic stays in the GraphQL package.

This completes P3.2 for the explicitly supported acquisition subset. P3.3–P3.8 still include invalidation/refresh coverage, reconciliation, race handling, cancellation, retry policy, and additional adapter scenarios. Angular integration and the Apollo comparison follow those tasks.

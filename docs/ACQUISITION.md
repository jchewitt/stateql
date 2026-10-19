# Acquisition and selective refresh

P3.2–P3.4 connect the planner to the shared store through a portable acquisition boundary and add selective invalidation/refresh and keyed-list reconciliation. The GraphQL package offers an HTTP default and an injectable transport for tests or alternate execution environments. Core still imports no GraphQL, framework, HTTP, browser, Node, or timer API.

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

Run `pnpm check` then `pnpm demo:acquire`. This self-contained demo starts the fixture on an ephemeral port, loads two identical consumers, extends one view with `amountCents`, advances server data, and invalidates `accountId`. All three consumers see the updated account IDs while amounts remain cached and the state address stays unchanged. It then reverses server order: a field refresh preserves cached order, and an explicit list refresh adopts server order and current amounts. The demo prints all five HTTP requests and disposes the client/server.

## Selective invalidation and refresh

```ts
await handle.invalidate('accountId'); // Mark stale immediately, then refetch.
await handle.invalidate('user.name'); // A nested selected field.
await handle.invalidate('user'); // This view's selected fields beneath user.
await handle.invalidate(); // This view's entire declared selection.
await handle.invalidate('accountId', { refetch: 'none' }); // No request.
await handle.refresh('accountId'); // Force a read without marking stale first.
```

Targets are inferred from the bound GraphQL definition, including response aliases. Unknown or unselected targets reject before changing state or issuing a request, even for JavaScript callers. A branch targets only its declared descendant selection; cached extensions owned by other views are not widened into it. No argument means the calling handle's selection, not every cached field or every argument scope. Handles are active from creation until disposal, whether or not they have subscribers. The default `refetch: 'active'` schedules a read; `'none'` marks stale synchronously and resolves immediately.

Both operations retain values while fetching. Their promises settle after the requested read, or reject on failure. Invalidation keeps affected fields stale if the read fails; refresh does not change freshness before requesting. Unrelated field values, freshness, and fetching metadata stay unchanged. Successful writes clear their own stale state. Known empty membership has no field cells to mark; an explicit refresh still issues a request, while `ensure` continues to reuse that empty membership.

Reads remain serialized by state address. Explicit refresh/invalidation calls each schedule a read; overlapping forced calls are not yet deduplicated. An invalidation arriving after a read starts is applied again atomically with that older response, so the response cannot clear it. This also works before initial membership exists. Mark-only invalidation remains pending for a later `ensure` or refresh; default invalidation queues its own read. The older read can successfully settle while the shared snapshot remains stale because of the newer invalidation. This narrow race protection does not implement the general concurrent generation/cancellation scheduler in P3.6.

## Acquisition and observations

`watch` starts acquisition without waiting for a listener. `getSnapshot` is side-effect-free. `ready` rejects on initial failure; an internal rejection handler prevents unhandled errors when UI code observes snapshot errors instead. `ensure` is an explicit promise-returning retry/fill operation, not a forced refetch. There are no automatic retry loops yet.

Reads are serialized within each resource address. After earlier work settles, each queued consumer recomputes its missing/stale/error coverage. Identical consumers therefore reuse the first successful acquisition, while extensions only fetch additional fields. Different addresses can progress independently. This deliberately precedes the general concurrent-request/generation scheduler planned in P3.6.

Snapshots currently expose the store's immutable `records`, `complete`, `stale`, `membershipStale`, and `fetching` plus a handle-level acquisition `error`. That error describes this handle's last failed attempt and is cleared when its next queued read/ensure starts; mark-only invalidation does not clear it. Another handle may fill the shared cache without clearing it. They are JSON projections, not yet schema-inferred application data envelopes. Record identities and aliases are preserved. Known empty membership is reused. Listener failures go to optional `onListenerError`, never into transport retries; without a handler they are ignored. Error reporting callbacks cannot disrupt acquisition.

Disposing a handle removes its subscriptions and freezes its readable snapshot. Another owner can still use the in-progress acquisition. Client disposal, or having no active owners when a response settles, prevents its commit. A new owner joining before completion can reuse that in-flight read; ownership epochs are deferred to P3.6. Underlying HTTP cancellation, timeouts, timed retention, and general field generations are not implemented in this increment; transports can remain in flight until they settle. Inactive data is retained until client disposal.

## Decoder and reconciliation boundary

The initial read establishes membership. Subsequent field acquisition merges by configured record identity and preserves order. Keyed collections reconcile added/missing identities as described below. Non-collection sources still reject a changed resource identity; root-object structural replacement remains later work.

The GraphQL decoder validates response shapes, `__typename`, identities, scalar values, selected field presence, and non-null constraints before returning changes. Nullable embedded objects and scalar lists are supported. Omitted fields, any GraphQL errors, malformed identities, null resource/ancestors, and nested object lists fail explicitly. Failed GraphQL decoding commits no partial response; existing values remain available. P3.5 will add protocol-aware partial-error and structural-null reconciliation. The portable core can retain successful writes from a source that omits fields, but reports incomplete acquisition and requests the remaining fields on the next ensure.

## Keyed lists and membership refresh

```ts
await invoices.refresh('accountId'); // Patch known records; keep membership/order.
await invoices.refresh(); // Same policy for all fields declared by this view.
await invoices.refreshList(); // Replace membership/order and refresh this view's fields.
```

A narrow response may return a reordered subset or new records. Matching records update by identity. Unknown records are ignored; missing records remain cached. Added or missing identities set shared `membershipStale: true`. Merely returning the same members in a different order does not set the flag or reorder the cache. If a known record is missing, its requested fields are marked stale and the operation rejects as incomplete **after** valid matching writes commit. This covers a record disappearing from a filtered list: the cache cannot infer that record's new field value. If the only membership change is added records, the field refresh resolves because all known targets were returned, but membership stays flagged.

`membershipStale` is also true before membership is first acquired. Overall `stale` includes this flag; `complete` only describes whether selected fields of cached members are present without errors. Thus a view can be complete while membership is stale. The flag is sticky until membership replacement. `ensure()` still acquires missing/stale/error fields; it never silently replaces membership, even when the membership flag is set. Call `refreshList()` to resolve it.

`refreshList()` requests the calling handle's entire declared selection, preserving its scope and arguments. A successful response atomically replaces membership and order, clears the membership flag, removes absent records, and admits new records with the requested fields. Retained records preserve unrequested cached siblings. Other views share the new membership immediately; a wider view may be incomplete for newly admitted records and can call `ensure()` to acquire its additional fields. Removed records do not retain hidden values for later reinsertion. List refresh reports fetching to all views of that resource, including views with disjoint field selections.

Malformed identities, duplicate identities/field paths, contradictory field trees, or incomplete whole-list responses reject before changing membership or values. An older list response cannot clear a later field invalidation: those targets remain stale on both retained and newly admitted records. Disposal and serialized queue rules are the same as for field refresh. Each handle retains its own last-attempt error; another handle's list refresh does not clear it.

The provisional source contract opts in with `collection: true`; GraphQL derives this from the resource's schema field. `refreshList()` rejects for non-collection sources. This prototype requires reliable configured identity for GraphQL lists and still rejects unkeyed lists, nested object lists, and pagination merging. Whole-list fallback without identities is not implemented; it must not be approximated with positional identities.

## Requested, fetched, and committed coverage

The coordinator requests canonical fields from the handle's definition. A source can optionally implement `fetchSelection(requested)` to expand the fetched selection within its own declared selection. The expansion must contain every requested field; invalid coverage rejects before transport. Without this method, fetched coverage equals requested coverage, as in the GraphQL source. Required GraphQL identity/context fields are protocol metadata and decoded separately from domain writes.

Source `read(fetched)` returns decoded records. Every returned field must be valid within fetched coverage; a write outside it rejects before any commit. The coordinator filters ordinary writes to requested coverage. Extra fetched sibling values never overwrite cached values or clear their freshness. A fake whole-resource source exercises this contract without introducing REST into core. Requested ancestor object markers and successful nulls still commit: changed object identity or a null must discard obsolete descendants even if some descendants were outside the request. This is necessary structural reconciliation, not permission to replace siblings with extra fetched values.

Only successfully returned requested writes become fresh. The portable core reports omitted requested fields even when old values exist, while retaining successful returned writes; GraphQL remains strict and rejects any omitted selected field before committing. Source callbacks never receive direct access to the store. An HTTP transport receives the prepared operation and returns the GraphQL envelope. GraphQL schema logic stays in the GraphQL package.

This completes P3.2–P3.4 for the explicitly supported subset. P3.5–P3.8 still include protocol partial errors, concurrent race handling, cancellation, retry policy, and additional adapter scenarios. Angular integration and the Apollo comparison follow those tasks.

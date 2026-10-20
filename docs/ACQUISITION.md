# Acquisition and selective refresh

P3.2–P3.7 connect the planner to the shared store through a portable acquisition boundary and add selective invalidation/refresh, keyed-list reconciliation, partial-error/null handling, concurrent scheduling with cancellation, and bounded read retries. The GraphQL package offers an HTTP default and an injectable transport for tests or alternate execution environments. Core still imports no GraphQL, framework, HTTP, browser, Node, or timer API.

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

Forced reads can run concurrently, and identical current requests share execution. An invalidation arriving after a read starts is applied again atomically with that older response, so the response cannot clear it. This also works before initial membership exists. With mark-only invalidation, the older read can successfully settle while the snapshot remains stale. Once a newer read starts, older overlapping writes are excluded and its forced promise rejects with `AcquisitionSupersededError`; unaffected fields may still commit. See the [concurrency contract](CONCURRENCY.md) for generation, structural, and ownership rules.

## Acquisition and observations

`watch` starts acquisition without waiting for a listener. `getSnapshot` is side-effect-free. `ready` rejects on terminal initial failure; an internal rejection handler prevents unhandled errors when UI code observes snapshot errors instead. `ensure` is an explicit promise-returning retry/fill operation, not a forced refetch. GraphQL defaults to two additional attempts for classified transient transport failures; see [retry configuration and limits](RETRIES.md).

`watch` and `ensure` wait for relevant current in-flight work and recompute missing/stale/error coverage before starting another request. Identical consumers reuse acquisition, while extensions fetch additional fields. They recompute after superseded work rather than treating supersession as a source failure. Forced reads and different addresses can progress independently.

Snapshots currently expose the store's immutable `records`, `complete`, `stale`, `membershipStale`, `resourceError`, and `fetching` plus a handle-level acquisition `error`. That handle error follows its latest invoked read/ensure attempt and clears when that attempt starts; an older late failure cannot replace it. Mark-only invalidation does not clear it. Another handle may fill the shared cache without clearing it. Shared failures appear in `records[].fields[].error` or `resourceError`, so peers see relevant failures even without explicitly starting the request. Snapshots are JSON projections, not yet schema-inferred application data envelopes. Record identities and aliases are preserved. Known empty membership is reused. Listener failures go to optional `onListenerError`, never into transport retries; without a handler they are ignored. Error reporting callbacks cannot disrupt acquisition.

Disposing a handle removes its subscriptions, freezes its readable snapshot, and promptly rejects its pending operations with `AcquisitionCancelledError`. Other interested owners keep shared work alive. Final-owner departure cancels the request and rejects late writes, even if the source ignores cancellation; a later owner cannot adopt that canceled execution. GraphQL forwards cancellation to the default HTTP fetch. Client disposal cancels all work and releases state. Timeouts and timed retention are not implemented; inactive data is retained until client disposal.

## Decoder and reconciliation boundary

The initial read establishes membership. Subsequent field acquisition merges by configured record identity and preserves order. Keyed collections reconcile added/missing identities as described below. A non-collection source returns at most one record; a changed singleton identity replaces that record and discards its old unrequested fields.

The GraphQL decoder validates response shapes, `__typename`, identities, scalar values, and non-null constraints before returning changes. Nullable embedded objects, scalar lists, resource/ancestor nulls, and located partial errors are supported. Malformed envelopes/identities/scalars, unlocatable or contradictory errors, and nested object lists reject before any commit. Null entries in a keyed object list also reject because they supply no identity; StateQL never guesses an existing record by response index.

## Partial errors, omissions, and nulls

GraphQL execution errors are checked against the generated operation's response names, list positions, and schema nullability. Aliased paths resolve to canonical fields; list indexes locate returned identities rather than cached positions. Non-null failures propagate to their nullable boundary. This follows [GraphQL execution-error semantics](https://spec.graphql.org/September2025/#sec-Handling-Execution-Errors); StateQL's cache-retention choices below are library policy.

- Successful requested fields commit even when other requested fields fail. The read promise rejects after that atomic commit.
- A scalar or scalar-list failure retains the previous cached field, marks it stale, and exposes a shared field error. An initial failure leaves the value absent. Scalar lists are treated as one field; even when one element fails, remaining response values still undergo validation.
- A successful explicit null replaces its value. An object null clears all obsolete descendants, including cached extensions outside the requested selection.
- An error-induced object null also clears descendants, but carries a stale/error marker rather than becoming a fresh successful field. A later narrow recovery cannot resurrect old sibling data.
- An omitted selected field means no value update. Its old value remains readable but stale; acquisition rejects as incomplete. `ensure()` requests remaining missing/stale/error fields rather than refetching successful siblings. Omission is tolerated as an incomplete source response, not claimed as a conforming successful GraphQL result.

`records: undefined` means unacquired, `records: []` means a known empty list, and `records: null` means the selected resource or an ancestor is null. Successful null is complete and reused by `ensure()`. Failed null exposes shared `resourceError`, is incomplete/stale, and is retried by `ensure()`. Both discard previous records. Mark-only invalidation makes a successful null stale; a later ensure reacquires the handle's selection. An invalidation during a read remains pending even if that older response resolves to null. Recovery creates records from returned fields, without restoring previously discarded values.

Errors without a usable path (including request/validation errors), malformed paths, and errors in identity/context fields that cannot be mapped safely reject the whole response. A correctly bubbled null from an identity failure can still be applied at its identified structural boundary. Classified transport failures can retry; terminal failures also mark eligible requested fields stale/error on existing records while retaining cached values. Resources without record cells retain their shape and report a handle error. GraphQL execution/validation failures are not automatically retried.

## Keyed lists and membership refresh

```ts
await invoices.refresh('accountId'); // Patch known records; keep membership/order.
await invoices.refresh(); // Same policy for all fields declared by this view.
await invoices.refreshList(); // Replace membership/order and refresh this view's fields.
```

A narrow response may return a reordered subset or new records. Matching records update by identity. Unknown records are ignored; missing records remain cached. Added or missing identities set shared `membershipStale: true`. Merely returning the same members in a different order does not set the flag or reorder the cache. If a known record is missing, its requested fields are marked stale and the operation rejects as incomplete **after** valid matching writes commit. This covers a record disappearing from a filtered list: the cache cannot infer that record's new field value. If the only membership change is added records, the field refresh resolves because all known targets were returned, but membership stays flagged.

`membershipStale` is also true before membership is first acquired. Overall `stale` includes this flag; `complete` only describes whether selected fields of cached members are present without errors. Thus a view can be complete while membership is stale. The flag is sticky until membership replacement. `ensure()` still acquires missing/stale/error fields; it never silently replaces membership, even when the membership flag is set. Call `refreshList()` to resolve it.

`refreshList()` requests the calling handle's entire declared selection, preserving its scope and arguments. A successful response atomically replaces membership and order, clears the membership flag, removes absent records, and admits new records with the requested fields. Retained records preserve unrequested cached siblings. Other views share the new membership immediately; a wider view may be incomplete for newly admitted records and can call `ensure()` to acquire its additional fields. Removed records do not retain hidden values for later reinsertion. List refresh reports fetching to all views of that resource, including views with disjoint field selections.

Malformed identities, duplicate identities/field paths, contradictory field trees, or omissions during whole-list refresh reject before changing membership or values. Located field errors during `refreshList()` can commit successful fields/errors for existing members, but retain existing array membership/order and mark it stale; newcomers are not admitted. Initial acquisition and recovery from `records: null` can establish identified partial records with errors because there is no existing array membership to preserve. A later successful list refresh replaces membership normally. An older list response cannot clear a later mark-only field invalidation: those targets remain stale on both retained and newly admitted records. If newer field work starts, the older membership replacement is conservatively rejected as superseded. Newer structural replacements block older responses from restoring removed records. Disposal and latest-attempt error rules are the same as for field refresh.

The provisional source contract opts in with `collection: true`; GraphQL derives this from the resource's schema field. `refreshList()` rejects for non-collection sources. This prototype requires reliable configured identity for GraphQL lists and still rejects unkeyed lists, nested object lists, and pagination merging. Whole-list fallback without identities is not implemented; it must not be approximated with positional identities.

## Requested, fetched, and committed coverage

The coordinator requests canonical fields from the handle's definition. A source can optionally implement `fetchSelection(requested)` to expand the fetched selection within its own declared selection. The expansion must contain every requested field; invalid coverage rejects before transport. Without this method, fetched coverage equals requested coverage, as in the GraphQL source. Required GraphQL identity/context fields are protocol metadata and decoded separately from domain writes.

Source `read(fetched, context)` receives a portable cancellation signal and returns decoded records, whose fields may be `write`, `object`, or `error` (optionally `structuralNull: true`). Alternatively, `{ kind: 'null', error?: string }` represents a null resource/ancestor. Every returned field must be valid within fetched coverage; a write/error outside it rejects before any commit. The coordinator filters ordinary writes and failures to requested coverage, then applies local generation checks. Extra fetched sibling values never overwrite cached values or clear their freshness. A fake whole-resource source exercises this contract without introducing REST into core. Eligible requested ancestor object markers and nulls still commit: changed object identity or a null must discard obsolete descendants even if some descendants were outside the request. This is necessary structural reconciliation, not permission to replace siblings with extra fetched values.

Only successfully returned, generation-eligible requested writes become fresh. Core reports omitted requested fields even when old values exist, while retaining successful returned writes; the GraphQL decoder preserves omissions for that policy. Source callbacks never receive direct access to the store. An HTTP transport receives the prepared operation plus cancellation context and returns the GraphQL envelope. GraphQL schema logic stays in the GraphQL package.

This completes P3.2–P3.8 for the explicitly supported subset. The [vanilla examples](VANILLA.md) exercise JavaScript/TypeScript consumers, whole-resource reads, and provisional validated event ingestion. Angular integration and the Apollo comparison follow.

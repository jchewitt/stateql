# Shared record store

P3.1 provides the storage and observation layer beneath the future client. It uses the canonical state address and resolved selection already produced by the GraphQL planner. It has no GraphQL, HTTP, framework, DOM, timer, or Node dependency.

Run `pnpm check` and `pnpm demo:store`. The TypeScript example derives two views from the generated billing schema. An amount update notifies only the extended view; an account-ID update notifies both. Changes are supplied directly to the store in this example. No network request runs.

## Provisional adapter-facing API

```ts
const store = new StateStore();
const view = store.watch(bound.stateAddress, bound.selection);
const unsubscribe = view.subscribe(() => render(view.getSnapshot()));

store.commit(bound.stateAddress, [
  { kind: 'membership', records: [{ tenantId: 'A', id: '1' }] },
  {
    kind: 'write',
    record: { tenantId: 'A', id: '1' },
    path: [{ name: 'accountId', arguments: {} }],
    value: 'account-new',
  },
]);

unsubscribe();
view.dispose();
store.dispose();
```

This is the internal store interface for the proof of concept, not the eventual application-level GraphQL client. Applications will receive typed resource projections from the client. The store exposes immutable JSON projections and record identities; it does not infer schema result types or accept raw GraphQL responses.

## Storage and commit rules

Each scoped state address owns explicit ordered membership and records keyed by canonical identity. A new consumer projects existing records immediately without owning another cache. Canonical field names and arguments locate values; consumer response aliases affect only projection keys and status paths.

One `commit` is atomic. Invalid identity, unknown record, duplicate membership, malformed path, or invalid JSON value rejects the batch without applying earlier changes. Changes run in declared order: membership must admit a new record before a write targets it. A membership replacement preserves retained records, changes order explicitly, and removes records no longer present. Field writes never insert or delete members or reorder the list.

`membership-stale` flags shared membership without changing records or field freshness. It affects every view's `membershipStale` and overall `stale`. A `membership` replacement clears the flag, including when it establishes an empty list. Unknown membership starts stale. `complete` remains a statement about selected values in cached records, not membership freshness.

Nested fields use canonical segment arrays. Writing a child establishes embedded object ancestors. An explicit `object` change can carry identity; a changed identity discards old descendants. A `write` of null replaces that structural branch and removes its descendants. A successful write clears that field's stale/error state. Explicit object success clears the parent marker only; it does not mark stale children fresh. Plain object/array leaf values are opaque JSON; normalized nested object lists remain future reconciliation work.

`stale` and ordinary `error` changes preserve the previous value. Branch changes mark existing descendants individually, allowing a later successful child write to recover without making siblings fresh. Missing descendants inherit branch errors. Nested status remains visible beneath a missing/null parent without resurrecting its old data. An `error` with `structuralNull: true` instead writes null, removes descendants, and leaves the branch stale with the supplied error. Missing fields are omitted from data and reported as missing in `fields`; successful null is present. `complete` means selected values are present without errors, even if stale.

Unknown membership is `records: undefined`; acquired empty membership is `records: []` and complete. A `resource-null` change clears all records and exposes `records: null`. It is complete/fresh when successful; an optional error appears as shared `resourceError` and makes the resource incomplete/stale. A later membership replacement clears that error and starts with fresh records, without resurrecting values removed by the null. `membership-stale` can also mark a null resource for reacquisition.

## Observation and lifecycle

`getSnapshot()` has no side effects and returns the same object until projected data or relevant metadata changes. Snapshots, identities, selections, nested values, and status paths are frozen. A no-op write or an unrelated field change does not notify. Each batch updates all consumer snapshots before calling listeners.

Duplicate callback registrations are independent subscriptions. Unsubscribe and disposal are idempotent. A disposed view retains its final readable snapshot and receives no more updates; new subscriptions on it fail. Other views remain active. Listener exceptions are collected after other listeners run and reported with `AggregateError`; the state has already committed. A source coordinator must distinguish listener failure from transport failure and must not retry writes because a listener threw.

`setFetching(address, requestId, selection, membership?)` records coverage; calling it without selection removes that request. The optional membership flag makes all resource views report fetching because their membership may change. Otherwise, only views interested in the selected fields report fetching. Multiple request IDs can overlap. This is bookkeeping, not scheduling, execution, deduplication, or cancellation.

Inactive data remains available until explicit `evict(address)` or store disposal. Eviction rejects active views or request markers. The acquisition coordinator owns request cancellation and opt-in [inactive retention](RETENTION.md); the store itself does not schedule timers. Store disposal releases all views and records and rejects further work.

`matchesObject(address, record, path, identity?)` lets the coordinator inspect an existing object marker without creating state. It distinguishes a retained object from a structural replacement before applying generation barriers. Like the other store interfaces, it is provisional infrastructure rather than an application query API.

## Remaining runtime work

P3.2–P3.7 add [acquisition, selective refresh, keyed-list reconciliation, partial-error/null handling](ACQUISITION.md), [concurrent scheduling with cancellation](CONCURRENCY.md), and [bounded retries](RETRIES.md). P3.8 still needs alternate-source demonstrations. This store does not decide which server response is current or whether a partial list response should replace membership. The coordinator/decoder makes those decisions before calling `commit`.

P4 will connect the completed runtime to Angular and forms. P5 then compares application wiring, correctness, requests, payloads, planning cost, and bundle size against the existing Apollo baseline. P3.1 alone is not enough to make that comparison.

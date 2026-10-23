# Freshness expiry

B2 adds opt-in age-based expiry to the standalone client. Alpha.3 and earlier do not include it; the `freshness-expiry` Changeset delivers this feature. Expiry keeps cached values and completeness, and marks only expired coverage stale. It does not evict data, impose a request deadline, or require a stream/server companion.

```js
const client = createGraphQLClient({
  endpoint: 'https://api.example.com/graphql',
  requestPolicy: {
    requestTimeoutMs: 10_000,
    freshness: { staleTimeMs: 30_000, revalidate: 'on-demand' },
  },
  requestPolicyGroups: {
    live: { freshness: { staleTimeMs: 5_000, revalidate: 'active' } },
  },
});
const handle = client.watch(invoices.bind(variables, scope), { group: 'live' });
// Disable inherited expiry for a different resource:
const other = client.watch(referenceData.bind({}, scope), {
  requestPolicy: { freshness: { staleTimeMs: false } },
});
```

Freshness shares the existing policy-group resolver. Each property inherits global → named group → resource binding; omitted/undefined inherits, and `staleTimeMs: false` disables expiry. Defaults are `false` and `on-demand`, preserving prior cache reuse. Duration accepts integer milliseconds from 0 through 2147483647. Zero means immediately stale after a successful commit and is allowed only with `on-demand`. Reject active+zero, unknown keys/modes, and invalid durations before attaching a consumer. The effective freshness policy is immutable for the cached resource's lifetime and must agree among its consumers; group names never change cache identity. One duration applies to the resource, with independent ages for each committed field and membership. Field-specific duration overrides are not part of B2.

## Coverage and membership

Age begins when a successful, generation-eligible value is committed, including a same-value write or accepted in-process patch. A field refresh renews only committed field coverage. Extra fetched context, superseded responses, omitted values and failures do not renew it. Object markers provide structural context; they do not renew untouched sibling leaves. A successful ancestor null has its own age and satisfies the selected subtree. Object identity changes, null replacement and deleted membership discard obsolete descendant/record deadlines.

Membership has a separate age using the same configured duration. A successful initial acquisition, explicit `refreshList()`, or freshness-driven membership acquisition renews it; a narrow field read does not. Null resources and empty lists therefore expire even though they contain no leaf values. Membership replacement preserves the ages of retained unrequested fields.

When **freshness has expired membership**, `ensure()`/new ownership requests the caller's full selection and reconciles membership/order. Other active views may need acquisition for additional fields on new records, as with `refreshList()`. This is an intentional opt-in behavior: ordinary narrow-read membership mismatch still requires explicit `refreshList()` and is not silently promoted to replacement. If membership is fresh, on-demand acquisition requests only missing/stale/error fields. Partial or failed membership refresh cannot silently admit incomplete records; the existing reconciliation rules remain in force.

## Revalidation and ownership

`on-demand` marks expiry without starting I/O. New handles acquire automatically; existing consumers call `ensure()` or a refresh when needed. Reading/subscribing to a snapshot does not start a request. Cached values remain readable during acquisition. With zero duration, one call can settle successfully while its result is already stale: it does not repeatedly request the same successfully satisfied coverage. Explicit invalidation/newer supersession is still honored while waiting on other reads.

`active` triggers acquisition for affected active owners once per expiry event, using normal shared deduplication, retry, deadline and handle-error behavior. It respects each owner's selection; cached unobserved fields are marked stale without independently fetching them. A successful replacement starts a new age, so active mode can repeatedly revalidate relative to successful commits. This differs from B6's explicit [polling interests](POLLING.md) and their independent cadence. Failed coverage remains stale without rearming itself; explicit demand or another independent expiry event can try again. Zero active duration is rejected to prevent an immediate loop.

Expiry of an old cached value does not create a server invalidation or supersede a read/retry already underway. A newer eligible response can satisfy it. Explicit invalidation and generation guards still protect newer updates. Expiry may require one later membership read after a narrow read finishes; those are separate shared requests and deadline budgets.

One nearest-expiry timer is retained per active resource, independent of its request/retry timers. Final-owner departure cancels it while keeping due metadata; a later owner checks elapsed age before reacquisition. One owner's departure does not stop another's work. Client disposal releases timers and metadata. B3 [inactive retention](RETENTION.md) can evict the whole resource and its age metadata.

## Clock boundary and verification

Portable core requires an injected `FreshnessScheduler` when expiry is enabled: `now()` returns finite nondecreasing milliseconds in one runtime-local clock domain, and `wait(ms, signal)` resolves after that duration and releases resources on cancellation. Methods are captured at client construction. The assembled GraphQL client supplies `performance.now()` and platform timers, including when retries are disabled. Core imports neither platform globals nor a framework. A custom retry/deadline scheduler is not implicitly a freshness clock; supply `freshnessScheduler` explicitly for deterministic/custom timing.

Timer delivery can be delayed by the platform; this is not a hard real-time or server-revision guarantee. Demand also checks elapsed age. Scheduler failure marks retained and subsequently accepted coverage stale, exposes an error on active handles, and disables automatic expiry/revalidation for that resource; recreate the client to restore reliable timing. It does not start a recovery loop. Handle errors may be cleared by later explicit operations, while the failed resource remains conservatively stale. Cancelled callbacks cannot expire newer values even if a custom scheduler ignores cancellation; private resources inside such an adapter remain its responsibility.

Run `pnpm demo:freshness` after `pnpm build` for a plain JavaScript example. Installed-package acceptance runs it with no TypeScript runtime and checks editor types. Deterministic core tests exercise coverage, sharing, null/empty/list semantics, zero age, inactive reuse, retry/deadline races, invalidation, scope binding and clock failure. GraphQL tests cover policy forwarding and the native clock boundary.

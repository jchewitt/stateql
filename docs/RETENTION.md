# Inactive-cache retention

B3 adds opt-in eviction of an entire inactive resource. Alpha.4 and earlier do not include it; the `inactive-retention` Changeset delivers this feature. Retention measures time after the final owner leaves. It is independent of field freshness age and request deadlines, and requires no stream or server companion.

```js
const client = createGraphQLClient({
  endpoint: 'https://api.example.com/graphql',
  requestPolicy: {
    retentionMs: 300_000,
    freshness: { staleTimeMs: 30_000, revalidate: 'on-demand' },
  },
  requestPolicyGroups: {
    transient: { retentionMs: 0 },
    reference: { retentionMs: false },
  },
});
const view = client.watch(invoices.bind(variables, scope));
await view.ready;
view.dispose(); // The five-minute window starts only if this was the final owner.
```

`requestPolicy.retentionMs` accepts `false` or integer milliseconds from 0 through 2147483647. Omitted/undefined inherits global → named group → resource override. The default `false` preserves indefinite inactive retention until client disposal; zero evicts synchronously after the final owner is released and pending work is cancelled. Zero and false require no clock. Positive values retain the whole resource until its inactive deadline; no count/byte limit or active-cache eviction is implied. Timer delivery can be delayed by a suspended/busy platform; demand also checks elapsed time before reusing the cache.

## Ownership, reuse and rebinding

A handle counts as an owner until disposed, even without subscribers. Removing a subscription does not release ownership. One owner's disposal cannot start retention while another owns the resource. The actual transition to zero owners cancels request/retry/deadline work and freshness timers, then starts one retention timer. Repeated disposal is a no-op and cannot extend the window.

A valid owner arriving before the deadline cancels retention and reuses cached data with its original freshness ages, errors and membership. It does not make stale fields fresh. The next final departure starts a new full retention window. A rejected watch does not cancel or extend an existing deadline. At or after the deadline, a new watch evicts overdue state before checking an old policy binding, even if timer delivery was delayed.

Eviction removes the resource's values, membership, errors, generation/invalidation metadata, freshness coverage, internal view and policy binding from the client. Late responses/finalizers and cancelled timer callbacks cannot resurrect it or affect a new same-address resource. A later watch starts unacquired, executes a fresh read and can establish a new effective policy. Before eviction, all consumers of the address must agree on effective retention, freshness and timeout policy; a different group name alone never creates another state identity.

Disposed handles continue to expose their last immutable snapshot. Those application-held snapshots and source/handle references naturally live as long as the application retains them; eviction releases the shared cache rather than making external JavaScript references disappear. Internal resource records and generation maps are cleared, and the coordinator drops its private view. Separate tenant/schema/resource addresses evict independently.

## Scheduling and failure

Portable core accepts a `retentionScheduler: MonotonicScheduler` (`now()` and cancellable `wait(ms, signal)`). If omitted, it uses a supplied `freshnessScheduler`. `FreshnessScheduler` remains a compatible alias of `MonotonicScheduler`; existing consumers need no change. Retry/deadline schedulers are not implicitly monotonic clocks. The assembled GraphQL client supplies its native monotonic clock/platform timer when neither override is supplied, including when freshness and retries are disabled. Methods and policy values are captured at client construction/binding.

`now()` must return finite nondecreasing milliseconds in one runtime-local clock domain. Positive retention validates a clock before creating resource state. Timer wakeups check actual elapsed age; early delivery waits for the remaining duration. Cancellation and clock callbacks may reenter application code, so phase/generation and exact resource-instance guards protect active owners and replacement scopes. Recursive initialization of the same address is explicitly rejected; initialization of another address remains allowed. Adapters should release private timer resources on cancellation; core cannot free resources hidden inside an uncooperative adapter.

If an inactive resource's clock or wait fails, core conservatively evicts that inactive resource. Optional `onRetentionError(error, stateAddress)` runs after cleanup; exceptions in diagnostics do not break disposal or other resources. An obsolete callback after reacquisition produces neither eviction nor a misleading error. Scheduler failure does not trigger network recovery; the next consumer acquires normally. Client disposal cancels all retention timers, clears caches and emits no retention-failure diagnostic for ordinary cancellation.

Run `pnpm demo:retention` after `pnpm build` for a native JavaScript example showing shared ownership, zero retention, reacquisition and readable disposed snapshots. Installed-package acceptance executes the example without a TypeScript runtime and checks its editor types. Deterministic tests cover deadline boundaries, disabled/zero semantics, repeated disposal, policy rebinding, delayed/early callbacks, scope isolation, cancelled reads/retries/deadlines, freshness reuse, clock failures and reentrant adapters. GraphQL tests cover global/group/resource setup, scope isolation and default platform scheduling.

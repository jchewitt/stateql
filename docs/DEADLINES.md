# Shared request deadlines

Stage B's first slice adds an opt-in deadline around one shared acquisition, including source attempts and retry waits. This checkout introduces the feature through the `shared-request-deadlines` Changeset; alpha.2 does not include it. [Timed freshness](FRESHNESS.md) is implemented separately in B2; [inactive retention](RETENTION.md) is implemented in B3, while provider registration remains a later task.

```js
const client = createGraphQLClient({
  endpoint: 'https://api.example.com/graphql',
  requestPolicy: { requestTimeoutMs: 10_000 },
  requestPolicyGroups: {
    forms: { requestTimeoutMs: 5_000 },
    longReads: { requestTimeoutMs: false },
  },
});

// Centralize this binding in the domain service so its consumers agree.
const binding = { group: 'forms' };
const first = client.watch(invoices.bind(variables, scope), binding);
const second = client.watch(invoices.bind(variables, scope), binding);
```

`requestTimeoutMs` accepts positive integer milliseconds through 2147483647. It is disabled by default in both portable core and GraphQL. Omitted or `undefined` values inherit; `false` explicitly disables. Zero, fractional, negative, non-finite and string durations fail validation. These are read deadlines; there is no write retry/mutation deadline API.

Resolution is client `requestPolicy` → the optional named `requestPolicyGroups` group → `watch` binding's `requestPolicy`. An empty policy inherits. A resource override can enable or disable a group/default deadline. Unknown groups and unsupported policy keys fail before attaching an owner or starting acquisition. Client defaults/groups and each binding are copied into immutable effective policy. Caller mutations cannot alter an existing binding.

Group names do not affect cache identity. Consumers of the same canonical state address must resolve to the same timeout, even when their selections or group names differ. A conflicting `watch` throws before changing ownership. Binding lasts as long as the cached resource scope: until client disposal or configured inactive eviction, including while a retention window remains open after the final handle leaves. Changing its policy requires a new client or a new scope lifetime after eviction; do not change the cache key to evade a conflict. Retry configuration remains client-wide; this slice does not introduce retry overrides or provider tokens/factories.

## Budget and outcomes

The timer starts when a shared request starts executing, before its first source call. One deadline covers all attempts and backoff; a joining owner inherits the remaining budget. Separate concurrent requests have independent deadlines. `ensure()` may wait for existing coverage and then request additional fields: that sequence is not one call-wide deadline. Timers are subject to the platform/custom scheduler's delivery, rather than a hard real-time guarantee while JavaScript is blocked.

When the deadline fires, the request rejects with exported `ReadTimeoutError` from `@tandrove/core` (`timeoutMs`, `retryable: false`). It cancels the transport and retry wait and clears fetching. A terminal timeout retains cached values and marks only generation-eligible requested fields stale/error, following the existing [failure rules](RETRIES.md#shared-state-and-lifecycle). Unknown, null and empty resources retain their shape. Newer updates cannot be overwritten by a late result; late rejection is consumed. Supersession can take precedence over a timeout when its writes are no longer eligible.

A later explicit `ensure()` or refresh can start a new request with a fresh budget. There is no automatic restart after the overall timeout. Disposing one consumer cancels only that consumer's wait; other interested owners retain the shared request and timer. Final-owner/client disposal cancels both. Success, source failure and supersession also release the timer. Scheduler failures are handle-level errors, not transport field errors.

## Scheduling and examples

Portable `AcquisitionClient` accepts `deadlineScheduler: DelayScheduler`, whose `wait(delayMs, signal)` resolves when the duration elapses. It should release its timer when the portable signal aborts. Core settles even if the implementation ignores cancellation, but cannot clean up private timer resources inside an uncooperative adapter. Deadline scheduling does not require randomness. Existing `scheduler: RetryScheduler` is reused if no separate deadline scheduler is supplied; retry randomness remains specific to retry backoff.

The GraphQL assembly supplies its native timer implementation by default and forwards cancellation to `AbortSignal`, including custom transports. Core imports no browser/Node timer or framework dependency. These injected scheduler instances are an existing capability boundary; they are not the planned A1 provider registry.

Run `pnpm build` followed by `pnpm demo:deadline` for the deterministic JavaScript example. The package acceptance check executes it against installed core/GraphQL tarballs with TypeScript absent, then checks its JavaScript editor types. Core tests use a fake clock for budget, sharing, retries, cancellation and cleanup; GraphQL tests cover policy forwarding and transport abortion.

# Bounded read retries

P3.7 adds a retry loop around source reads. Policy, scheduling, request ownership, and response reconciliation remain separate. All attempts share the original request's selection, local generation, owners, and fetching marker; a retry never acquires a newer generation to overwrite intervening work.

## GraphQL defaults and configuration

```ts
const client = createGraphQLClient({
  endpoint: 'https://api.example.com/graphql',
  retry: { retries: 2, initialDelayMs: 250, maxDelayMs: 30_000 },
});

// Opt out of automatic retries:
const immediate = createGraphQLClient({
  endpoint: 'https://api.example.com/graphql',
  retry: false,
});
```

The shown values are the assembled GraphQL defaults. `retries` counts additional attempts, so two means at most three source executions per shared request. Zero also disables retries. Policy is client-level and snapshotted at construction. Per-definition, per-consumer, and per-call overrides are deferred until there is a rule for conflicting owners of the same request.

The delay before retry index `n` (zero for the first retry) is full jitter: `floor(random() * min(maxDelayMs, initialDelayMs * 2 ** n))`. The random sample must be in `[0, 1)`. A classified `retryAfterMs` raises this delay to the server-requested minimum. If that minimum exceeds `maxDelayMs`, the operation fails instead of retrying too early. The default HTTP transport reads both seconds and date forms of `Retry-After`; invalid values are ignored. Retry counts must be integers from zero through ten; delay options must be integer milliseconds from zero through 2147483647, with initial delay no greater than the cap.

Retry settings alone bound attempt count and backoff, not elapsed duration. The separate opt-in [shared request deadline](DEADLINES.md) bounds the full read/retry chain. Without it, a request can remain pending until its transport settles or its final owner disposes. Timed cache retention remains follow-on work.

## Failure classification

The default HTTP transport classifies network failures before headers or during body transfer as retryable. HTTP 408, 429, 500, 502, 503, and 504 are retryable; other failed HTTP statuses, including authorization failures, are terminal. Request/header construction happens outside network classification. JSON parsing happens after body transfer, outside that classification too.

Only `ReadTransportError` with `retryable: true` enters the loop. Custom transports and portable sources opt in explicitly:

```ts
throw new ReadTransportError('Connection unavailable', {
  retryable: true,
  cause: underlyingFailure,
});
```

Ordinary exceptions, schema/selection errors, malformed JSON, invalid response data, GraphQL execution errors, missing fields, cancellation, and supersession do not trigger automatic source retries. Located GraphQL partial errors still commit successful fields using the existing reconciliation rules; a later explicit `ensure()` can acquire their remaining failed coverage. There is no mutation API or automatic write retry in this implementation.

## Shared state and lifecycle

Identical consumers share one request and one retry budget, including while it waits in backoff. `fetching` remains true during that wait, and cached values remain readable. Intermediate transport failures do not publish final field or handle errors.

When a classified transport failure becomes terminal, existing records retain their values and receive shared stale/error markers only for the requested canonical fields whose generations are still eligible. A broad source's extra fetched fields are untouched. A successful later acquisition clears the affected errors. Unknown, null, and empty resources keep their shape and report the terminal failure on the initiating handle because there are no record field cells to mark. A forced failure on a fresh null/empty resource does not automatically change its completeness; use explicit refresh/invalidation when needed.

An unclassified source exception stays a handle-level failure. Scheduler/configuration failures also stay handle-level and never masquerade as transport field errors. Handle errors continue to follow the latest invoked attempt; another consumer can repair shared fields without clearing that handle's last-attempt error.

The scheduler checks cancellation and current generation before retrying. A later overlapping request, invalidation, or structural replacement can supersede the old chain. Any such partial supersession conservatively stops further retries for that whole request. Forced reads reject with `AcquisitionSupersededError`; `ensure()` recomputes coverage under the newer state. Disjoint requests remain independent.

Disposing one consumer does not cancel another interested owner's retry. Final-owner or client disposal cancels the request and pending delay immediately. Core races scheduler waits against its portable cancellation signal, so even a scheduler that ignores cancellation cannot hold disposed consumers open. The default platform scheduler also clears its timer.

## Portable scheduler boundary

Portable `AcquisitionClient` defaults to no automatic retries. To enable them, pass `retry` and a `RetryScheduler` with `wait(delayMs, signal)` and `random()` methods. The GraphQL assembly supplies native timers and randomness by default and accepts the same injection for deterministic tests. Core imports no timer, DOM, Node, GraphQL, or framework API.

Tests control reads and scheduler completion directly, covering attempt limits, jitter/caps, server delay hints, cancellation, supersession, shared ownership, generation-filtered terminal errors, real HTTP failures, and malformed results. No polling, stream reconnect loop, or offline command replay is implied by this read policy.

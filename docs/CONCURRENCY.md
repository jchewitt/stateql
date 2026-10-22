# Concurrent acquisition and cancellation

P3.6 replaces serialized forced reads with a scheduler per scoped state address. It keeps request ownership, local commit generations, and cancellation separate from transport execution and GraphQL decoding.

## Shared work

`watch()` and `ensure()` reuse fresh fields. When relevant current work is already running, they wait and recompute missing/stale/error coverage before starting another read. Initial consumers share a baseline before acquiring additional fields. Forced `refresh()`, default `invalidate()`, and `refreshList()` can run concurrently.

Identical in-flight requests share one execution when their wire fingerprint, requested fields, fetched fields, and membership policy match within the same resource. A request invalidated or superseded since it started is not reused. Different aliases may generate different operations and therefore different fingerprints, but still address the same canonical stored fields. Overlapping operations are not automatically batched.

The optional provisional source method `fingerprint(fetchedSelection)` identifies wire execution. Without it, the canonical fetched selection is used. Sources sharing a state address must refer to the same logical resource and agree on collection semantics; sources with different wire behavior should supply distinct fingerprints. The GraphQL source derives the fingerprint from its generated operation and variables.

## Local ordering

A new request records its requested field generations when it starts. A later request for an overlapping field prevents older writes, errors, and stale markers from replacing that field, even if the later request fails. Disjoint fields can finish in either order.

For example, a full invoice refresh may start before a second refresh of `accountId`. The second request owns the newer generation for `accountId`. When the older full response arrives, it may still update the amount and other unaffected fields, but cannot replace the account ID. The older forced promise rejects with `AcquisitionSupersededError` after publishing any eligible changes atomically. Call `ensure()` to acquire any remaining missing/stale/error fields. This error is control flow, not a claim that the server failed.

An `ensure()` waiting on superseded work recomputes coverage and can resolve if newer work already satisfied it. Terminal source failures still reject promptly, even when other covering reads remain pending. [P3.7 retry policy](RETRIES.md) can recover explicitly classified transient transport failures before a request becomes terminal.

Mark-only invalidation has a different contract: an older response can populate values, but those fields remain stale. Starting a newer read then excludes older overlapping writes. This preserves pending invalidation even before membership exists or when an older response returns a null resource.

Structural changes need wider barriers. Null objects, object identity changes, and ancestor errors protect their affected subtrees. A newer membership replacement, singleton replacement, or null resource blocks older responses from restoring discarded records. The prototype conservatively rejects an older whole-resource replacement when any newer field work makes it unsafe. It does not try to split a membership change into independent per-record transactions.

All source results still undergo validation and reconciliation before generation filtering. Malformed responses cannot bypass validation by arriving late. Generations are reserved before publishing accepted changes so reentrant listeners cannot erase the ordering boundary.

P3.8's provisional `AcquisitionClient.ingest()` validates an entire patch before advancing the local clock, then uses the same filtering/commit path. Barriers apply to changed records and fields; an event for one invoice does not suppress an older ordinary write to another invoice. Unsafe older resource replacements remain conservatively blocked. An overlapping event can stop an older retry chain. See [ingestion constraints and examples](VANILLA.md).

These counters describe this client's local requests and accepted patches. They cannot decide which server value is newest across devices, HTTP, or future streams. Authoritative revision ordering remains E2; separately refreshed fields also do not imply a transactional server snapshot.

## Ownership and disposal

An active handle owns relevant requests until disposal, whether or not it has listeners. A request is relevant when its requested fields overlap the view, or when it may establish/replace membership. An interested peer can keep a shared read alive even if it did not explicitly call refresh.

Disposing one handle freezes its final snapshot, removes its subscriptions, and rejects its pending operations with `AcquisitionCancelledError`. Other interested owners keep the underlying request alive. When the final interested owner leaves, the scheduler removes the fetching marker and cancels the request immediately. A later owner cannot adopt that canceled request; a transport ignoring cancellation cannot commit its late response. Client disposal cancels all owned work and releases its store.

Core's `AcquisitionContext.signal` is a portable `CancellationSignal` with `aborted`, `reason`, and `subscribe(listener)`. Subscribing after cancellation immediately invokes the listener; the returned unsubscribe function releases that registration. Cancellation callback errors cannot prevent other callbacks from running. Core settles canceled operations even if a source never settles its own promise.

The GraphQL boundary bridges that signal to a native `AbortSignal`. `GraphQLTransport` receives it in its optional second context argument; the default HTTP transport passes it to `fetch`. Custom transports can honor it too. Actual HTTP disconnection is covered by an integration test.

Handle-level `error` follows the latest invoked read/ensure attempt, so an older failing or superseded attempt cannot replace a newer attempt's status. Shared field/resource errors remain cache state visible to every relevant view. Mark-only invalidation does not reset the handle's attempt error.

Inactive cache data remains until client disposal by default. P3.7 adds [retry scheduling](RETRIES.md) while preserving these request generations and ownership rules. B1–B3 add opt-in [request deadlines](DEADLINES.md), [freshness expiry](FRESHNESS.md) and [inactive retention](RETENTION.md). A production stream protocol remains future work.

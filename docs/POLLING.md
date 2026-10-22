# Shared field polling

B6 adds explicit polling to query handles and Angular owned queries. It is pending a batched release and is absent from alpha.5. Polling uses the same selection, acquisition, retry, deadline and commit machinery as ordinary reads; it needs no streaming or server companion.

```js
const client = createGraphQLClient({
  endpoint: 'https://example.com/graphql',
  requestPolicy: { polling: { everyMs: 30_000 } },
  resourceGroups: {
    live: { requestPolicy: { polling: { everyMs: 10_000 } } },
  },
});
const invoices = client.watch(definition.bind(variables, scope), {
  group: 'live',
});
await invoices.ready;
const stop = invoices.poll({ target: 'accountId' });
// The declared accountId selection is refreshed; cached siblings remain intact.
stop(); // Idempotent; handle/client disposal also releases this interest.
```

`poll({ target?, everyMs? })` returns a stop function synchronously. An omitted target uses the handle's entire selection; nested targets and aliases use the same typed paths as `refresh()`. The interval is integer milliseconds from 1 through 2147483647, or `false`. Zero is rejected. An omitted interval inherits the captured global → group → resource `requestPolicy.polling.everyMs`, whose default is `false`. An explicit `false` creates an inert interest and does not stop other registrations. Configuration alone never starts polling. Invalid options and disposed handles throw synchronously.

## Sharing and cadence

The first tick is due one interval after registration. Within a cached resource, interests selecting identical underlying leaf paths and arguments share one schedule even when their response aliases or selection ordering differ. The fastest active interest determines the next tick. Different selections retain separate schedules; polling one field never promotes every field to that cadence. Polling defaults can differ between owners without changing state identity or causing a shared-policy conflict. Retry remains client-wide; shared deadline, freshness, retention and authority rules still apply.

The next interval starts after the current shared read/retry work settles. Each surviving interest becomes due after its own interval, and the earliest wins. Slow requests and late timers do not accumulate missed ticks. Removing the fastest interest restores the next surviving deadline; adding or removing another interest does not postpone existing deadlines. A newly registered interest during a running cycle participates in scheduling after that cycle settles.

A due tick joins overlapping or root acquisition already in flight, including retries. Only successfully completed, current requested coverage satisfies its selection. Extra fetched fields and a request's root status do not count as refreshed siblings. Remaining selected fields are acquired after the joined work settles. A failed joined request ends that tick; it cannot immediately start a second retry chain. A later cadence can recover after normal retries are exhausted. Explicit manual refreshes retain their forced-read behavior and may run concurrently; existing generation guards prevent older results from overwriting newer accepted values.

## Ownership, errors and membership

Stop releases future scheduling. It does not cancel a dispatched read while normal query ownership retains it. Stopping one consumer leaves other interests active. Releasing a handle removes all its interests; releasing the client stops all timers. A stale timer callback cannot revive a stopped group. Polling is independent of snapshot subscriptions: callers explicitly own the interest even when no component is currently observing it. Browser visibility policies are outside the portable core.

Polling follows `refresh(target)` semantics. It neither marks cached values stale before reading nor implicitly calls `refreshList()`. Existing list order/membership stays intact; a mismatch remains observable and requires explicit membership reconciliation. Null and empty resources follow the same rules as ordinary refresh. Use [freshness expiry](FRESHNESS.md) for age-based invalidation and its separately defined membership-revalidation behavior. Draft forms remain separate from shared server state.

Selected field failures and handle errors use the normal acquisition path. A later successful tick can recover them. An older polling failure cannot overwrite the handle error from a newer manual command. Scheduler failure stops the affected polling group and reports a handle error; it does not invalidate unrelated fields or start a recovery loop. A fresh explicit `poll()` registration can retry after the scheduler is repaired.

## Core and Angular boundaries

Portable core requires `pollingScheduler`, falling back to an explicitly supplied `freshnessScheduler`. Both use `MonotonicScheduler`: finite nondecreasing `now()` milliseconds in one local clock domain, and cancellable `wait(ms, signal)`. Methods are captured when constructing the client. An unused configured default needs no scheduler. The GraphQL client supplies its native monotonic clock and timers, including with `retry: false`. Retry/deadline clocks are not implicitly polling clocks. Platform scheduling can be delayed; intervals are not hard real-time guarantees.

Angular's `StateQuery.poll()` synchronously checks the current binding without adding reactive dependencies. It throws while binding is pending or after disposal. Register after `query.state().status` becomes `active`, and retain/stop the returned function as needed. Parameter replacement and injector destruction release the original handle's interests. A polling registration never silently transfers to a different tenant or resource; register again for a new binding if desired. `tandroveSignal()` only observes a caller-owned reader and does not start or stop its polling.

Run `pnpm demo:polling` after building for an executable plain JavaScript example with two consumers, one narrow refresh and independently stopped interests. Packed-package acceptance executes and type-checks it. Deterministic core tests cover coverage, arguments/aliases, cadence, ownership, retries/deadlines, failure recovery, reentrant cleanup and list/null behavior; GraphQL and Angular tests exercise emitted operations and binding lifetimes.

---
'@launch-echo/stateql-core': minor
---

Add explicit transport-failure classification, bounded read retries with injected scheduling, jittered exponential backoff, server delay hints, and shared terminal field errors. Retry attempts preserve request identity, generation, ownership, and fetching state; cancellation and supersession stop further attempts. Portable core retries remain opt-in with a scheduler, while the private GraphQL client defaults to two additional attempts and supports retry:false. HTTP failures are classified separately from JSON/schema decoding. Writes, timeouts, timed retention, and stream reconnect policies remain outside this increment.

---
'@launch-echo/stateql-core': minor
---

Run forced reads concurrently with scoped in-flight deduplication, local field generations, structural replacement barriers, and ownership-based cancellation. Superseded reads cannot overwrite newer fields; unaffected changes may still commit before AcquisitionSupersededError rejects the read. ensure recomputes missing coverage after supersession. Sources receive a portable cancellation signal and may provide a wire fingerprint. GraphQL bridges cancellation to AbortSignal and the default HTTP fetch. Retries, timed retention, and authoritative server revision ordering remain future work.

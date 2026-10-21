---
'@tandrove/core': patch
'@tandrove/graphql': patch
---

Add opt-in shared-request deadlines covering source attempts and retry backoff. Resolve captured timeout policies through global defaults, named groups and resource bindings; reject conflicts for consumers sharing a state address. Timeout aborts transport/retry work, preserves cached values with eligible field errors, and rejects with ReadTimeoutError. GraphQL supplies platform scheduling; portable core accepts a DelayScheduler. Existing clients keep deadlines disabled by default.

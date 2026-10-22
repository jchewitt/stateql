---
'@tandrove/core': patch
'@tandrove/graphql': patch
---

Add optional runtime-scoped provider registration with validated typed tokens, supplied instances, single-flight sync/async factories and explicit owned/borrowed cleanup. Support partial-initialization cleanup, cancellation, memoized failures and safe disposal of late factory results. GraphQL transport and custom acquisition tokens work with the existing synchronous clients; default GraphQL setup remains unchanged.

---
'@tandrove/core': patch
'@tandrove/graphql': patch
---

Add opt-in field and membership freshness expiry with shared global/group/resource policies, on-demand or active revalidation, injected monotonic scheduling, and lifecycle cleanup. Retain cached values when stale and preserve in-flight generation, retry, and deadline protections. GraphQL supplies the default platform clock; plain JavaScript consumers need no TypeScript runtime.

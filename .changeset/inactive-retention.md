---
'@tandrove/core': patch
'@tandrove/graphql': patch
---

Add opt-in inactive resource retention with global/group/resource `retentionMs` policies. Evict full cached scopes after the final owner leaves, preserve active owners and disposed snapshots, and allow fresh acquisition and policy rebinding after eviction. Support zero/disabled retention, monotonic scheduling, safe cancellation and late-response isolation; GraphQL supplies platform defaults.

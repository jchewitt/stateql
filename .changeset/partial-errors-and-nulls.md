---
'@jchewitt/stateql-core': minor
---

Support portable field failures and explicit null-resource acquisition. Retain successful partial updates and cached scalar values on field errors, mark omitted fields stale, and discard obsolete data on structural nulls or singleton identity changes. Snapshots now distinguish null resources from unknown/empty membership and expose shared resourceError. The private GraphQL source maps aliased execution-error paths and schema null bubbling into these changes. Concurrent scheduling and retries remain deferred.

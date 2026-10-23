---
'@tandrove/core': minor
'@tandrove/graphql': minor
'@tandrove/angular': minor
---

Infer selected snapshot data through GraphQL handles and Angular query signals. Add `SnapshotData<Result>` and defaulted snapshot/result generics while retaining readonly partial fields, scalar nullability, structural object nulls, dynamic JSON fallbacks and existing target-only consumers. `ResultOf` remains the full declared selection. Explicit `watch<Result>(...)` calls should instead infer from a typed bound definition. Cache storage, projection behavior, snapshot identity and JavaScript execution are unchanged.

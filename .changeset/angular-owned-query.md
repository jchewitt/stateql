---
'@tandrove/angular': minor
---

Add typed environment-owned client providers and reactive owned query views. Hide stale bindings immediately when parameters change, preserve field-target types, and release subscriptions/handles at the query lifetime without disposing the shared client. Reuse guarded observation setup with the existing readonly signal bridge.

Exercise provider ownership, argument changes, errors, shared requests, GraphQL invalidation, and installed Angular package consumers.

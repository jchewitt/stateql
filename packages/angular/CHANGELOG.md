# @launch-echo/stateql-angular

## 0.1.0-alpha.0

### Minor Changes

- 5e0c60b: Introduce the private Angular Package Format prototype with a readonly StateQL snapshot signal bridge. Subscribe within an Angular destruction lifetime while leaving reader/client ownership with the caller. Add lifecycle/type tests and isolated APF/Angular template consumer checks. Publication remains disabled.
- cf17005: Add typed environment-owned client providers and reactive owned query views. Hide stale bindings immediately when parameters change, preserve field-target types, and release subscriptions/handles at the query lifetime without disposing the shared client. Reuse guarded observation setup with the existing readonly signal bridge.

  Exercise provider ownership, argument changes, errors, shared requests, GraphQL invalidation, and installed Angular package consumers.

- Prepare the first usable standalone alpha under the @launch-echo scope: portable shared state, schema-driven GraphQL acquisition and selective refresh, and Angular signals/providers/owned query views. Ship ESM JavaScript with optional TypeScript declarations and an Angular partial-compilation package. Install matching alpha versions together; no server companion or streaming infrastructure is required. Extension interfaces and runtime snapshot typing remain experimental.

### Patch Changes

- Updated dependencies [96a9479]
- Updated dependencies [a1ceca0]
- Updated dependencies [b14d41b]
- Updated dependencies
- Updated dependencies [9b4a1ae]
- Updated dependencies [51d9b8e]
- Updated dependencies [272b3f2]
- Updated dependencies [75587d5]
- Updated dependencies [1d50674]
- Updated dependencies [b30c6e2]
  - @launch-echo/stateql-core@0.1.0-alpha.0

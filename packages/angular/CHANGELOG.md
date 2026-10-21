# @tandrove/angular

## 0.1.0-alpha.4

### Patch Changes

- Updated dependencies [154c387]
  - @tandrove/core@0.1.0-alpha.4

## 0.1.0-alpha.3

### Patch Changes

- Updated dependencies [c5cdb32]
  - @tandrove/core@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- 8768c25: Validate automated reviewed releases: synchronized versions, changelogs and installation examples now flow through a bot-maintained release PR and trusted publication after its reviewed merge. No runtime API changes.
- Updated dependencies [8768c25]
  - @tandrove/core@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- Validate the synchronized alpha release through GitHub trusted publishing. Release tooling waits for npm processing without repeating uploads, checks installed registry consumers and registry signatures, and reports a missing release-tag setting explicitly. Library runtime APIs are unchanged.
- Updated dependencies
  - @tandrove/core@0.1.0-alpha.1

## 0.1.0-alpha.0

- Rename the unpublished StateQL candidate to Tandrove: packages are `@tandrove/core`, `@tandrove/graphql` and `@tandrove/angular`. Angular APIs are `tandroveSignal` and `provideTandroveClient`. This is the first public version, with no old-name compatibility aliases.

### Minor Changes

- 5e0c60b: Introduce the private Angular Package Format prototype with a readonly Tandrove snapshot signal bridge. Subscribe within an Angular destruction lifetime while leaving reader/client ownership with the caller. Add lifecycle/type tests and isolated APF/Angular template consumer checks. Publication remains disabled.
- cf17005: Add typed environment-owned client providers and reactive owned query views. Hide stale bindings immediately when parameters change, preserve field-target types, and release subscriptions/handles at the query lifetime without disposing the shared client. Reuse guarded observation setup with the existing readonly signal bridge.

  Exercise provider ownership, argument changes, errors, shared requests, GraphQL invalidation, and installed Angular package consumers.

- Prepare the first usable standalone alpha under the @tandrove scope: portable shared state, schema-driven GraphQL acquisition and selective refresh, and Angular signals/providers/owned query views. Ship ESM JavaScript with optional TypeScript declarations and an Angular partial-compilation package. Install matching alpha versions together; no server companion or streaming infrastructure is required. Extension interfaces and runtime snapshot typing remain experimental.

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
  - @tandrove/core@0.1.0-alpha.0

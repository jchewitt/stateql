# @tandrove/graphql

## 0.1.0-alpha.5

### Patch Changes

- b492abe: Add opt-in inactive resource retention with global/group/resource `retentionMs` policies. Evict full cached scopes after the final owner leaves, preserve active owners and disposed snapshots, and allow fresh acquisition and policy rebinding after eviction. Support zero/disabled retention, monotonic scheduling, safe cancellation and late-response isolation; GraphQL supplies platform defaults.
- Updated dependencies [b492abe]
  - @tandrove/core@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- 154c387: Add opt-in field and membership freshness expiry with shared global/group/resource policies, on-demand or active revalidation, injected monotonic scheduling, and lifecycle cleanup. Retain cached values when stale and preserve in-flight generation, retry, and deadline protections. GraphQL supplies the default platform clock; plain JavaScript consumers need no TypeScript runtime.
- Updated dependencies [154c387]
  - @tandrove/core@0.1.0-alpha.4

## 0.1.0-alpha.3

### Patch Changes

- c5cdb32: Add opt-in shared-request deadlines covering source attempts and retry backoff. Resolve captured timeout policies through global defaults, named groups and resource bindings; reject conflicts for consumers sharing a state address. Timeout aborts transport/retry work, preserves cached values with eligible field errors, and rejects with ReadTimeoutError. GraphQL supplies platform scheduling; portable core accepts a DelayScheduler. Existing clients keep deadlines disabled by default.
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

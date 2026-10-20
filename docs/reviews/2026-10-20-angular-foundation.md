# P4.1 Angular package foundation review

Independent reviewer: `foundation_review`, before the implementation commit on October 20, 2026.

Scope: private Angular Package Format build, peer dependencies, readonly snapshot signal bridge, subscription ownership/destruction, package/type tests, isolated installed Angular template consumer, and the form draft/save architecture contract.

The reviewer approved the bounded design: observe existing readers without owning handles or adding a cache, and leave providers/reactive argument replacement for P4.2. Runtime review found a P2 cleanup leak when a reader synchronously notified during subscription and the resulting snapshot read threw before returning its unsubscribe function. The fix defers setup notifications until cleanup is available and then rechecks the snapshot under guarded cleanup. Direct subscription failures deactivate the callback. A regression reproduces the original retained-listener failure.

The reviewer independently passed all eight Angular tests and type checks after the fix. Its original reproduction now retains zero listeners and unsubscribes once. Final code, packaging, documentation, forms contract, and Changeset review found no remaining actionable findings.

The parent passed `pnpm check`: formatting, builds, generated-schema verification, strict type checks, 173 tests (16 tooling, 81 core, 4 fixture API, 6 Apollo baseline, 56 GraphQL, 2 vanilla examples, 8 Angular), existing isolated JavaScript/TypeScript consumers, and a new installed APF consumer. The Angular artifact check verifies native ESM observation/destruction and Angular AOT component/template compilation, package metadata/peers/license, and removal of stale output.

Form draft reconciliation is documented for P4.4/P4.5, not implemented in this package. Typing remains local by design; pending commands have separate immutable payloads and cannot clear newer edits. The contract distinguishes command success from refresh failure and records future revision/acknowledgement requirements. Production streaming, forms helpers, and publication remain outside this change.

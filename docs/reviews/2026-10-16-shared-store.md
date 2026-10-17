# Shared record store review

Independent reviewer: `foundation_review`, before the P3.1 commit on October 16, 2026.

Scope: portable shared-record storage, atomic commit validation, canonical field/argument addressing, projection aliases, structural null/identity changes, field metadata, stable snapshots, subscriptions, disposal/eviction, demo, packaging, and documented boundaries.

Findings addressed:

- Nested stale/error metadata disappeared under missing or null parents. Selected descendant status is now projected without resurrecting old data.
- Branch staleness/errors prevented independent child recovery. Branch metadata is materialized on existing descendants so successful narrow writes recover only their own fields.
- Implicit parent creation during recovery removed sibling errors. Parent creation now preserves sibling metadata and ancestor error fallback; explicit structural replacement retains its clearing semantics.

Fourteen store tests cover these regressions plus sharing, selection boundaries, no-op/unrelated updates, aliases/arguments, membership ordering, atomic rejection, immutability, concurrent request markers, listener failure, and lifecycle behavior. Negative type assertions cover readonly snapshots and required write contracts. The packed-consumer check now executes the installed store, and `pnpm demo:store` demonstrates schema-derived shared views with explicit teardown.

The independent reviewer rechecked the final recovery fix and cleared P3.1 with no actionable findings. It independently reran all 14 store tests successfully. The final full `pnpm check` is required before commit. This milestone completes P3.1 only. Execution, decoding/reconciliation, race protection, retries, Angular integration, and comparison remain later tasks.

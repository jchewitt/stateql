# Selective invalidation review

Independent reviewer: `foundation_review`, before the P3.3 commit on October 19, 2026.

Scope: typed GraphQL handle targets, canonical field/branch invalidation, mark-only invalidation, forced refresh, broader source fetch coverage with selective commits, serialized invalidation race protection, documentation, demo, and package consumer checks.

The reviewer approved the candidate with no actionable findings. It independently ran seven core invalidation tests and twelve GraphQL acquisition/invalidation tests, plus probes for nullable-branch recovery and refresh queued from a subscription callback. All passed. It also reviewed the final planner documentation and package smoke checks against the implemented scope.

The parent ran `pnpm check`: formatting, builds, generated-schema verification, strict types, 76 tests (16 tooling, 25 core, 4 fixture API, 6 Apollo baseline, 25 GraphQL), and real tarball installation into an isolated ESM/TypeScript consumer all passed. `pnpm demo:acquire` produced three HTTP requests: shared account-ID acquisition, additional amounts, and account-ID invalidation. Account IDs advanced from v1 to v2 across consumers while amounts stayed 12500/13000 and the state address stayed unchanged.

This completes P3.3 within the documented subset. Reads remain serialized, explicit forced refreshes are not deduplicated, and membership changes and GraphQL partial errors still reject. P3.4–P3.8 and the StateQL Angular adapter remain pending. No npm release is enabled.

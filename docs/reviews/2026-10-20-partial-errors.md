# P3.5 partial errors and nulls review

Independent reviewer: `foundation_review`, before the implementation commit on October 20, 2026.

Scope: portable acquisition failures/null results, shared store null/error snapshots, GraphQL error-path and null-bubbling decoding, behavioral tests, documentation, Changeset, and isolated packed-consumer validation.

The reviewer found one P2 issue: a scalar-list element failure bypassed validation of other returned elements. The fix validates the complete scalar/list field before retaining its cached value and publishing a field error. A regression verifies that malformed scalar siblings and non-null violations reject the entire envelope before any partial commit. The reviewer re-reviewed the fix, independently passed all 14 GraphQL partial-error tests and the four new core tests, and cleared the final candidate with no remaining actionable findings.

The review also confirmed the documented membership boundary: a failed list refresh preserves existing array membership, while an initial acquisition or recovery from a null resource may establish identified partial records with errors.

The parent ran `pnpm check` successfully: formatting, builds, generated schema verification, strict TypeScript checks, 107 tests (16 tooling, 39 core, 4 fixture API, 6 Apollo baseline, 42 GraphQL), and actual tarball installation into isolated ESM/TypeScript consumers. Packed runtime checks exercise field errors and resource nulls. `git diff --check` passed.

Concurrent scheduling, cancellation, and retry policy remain P3.6/P3.7 work. Null list entries without identity remain unsupported. No package was published; release readiness remains disabled.

# P3.6 concurrent acquisition review

Independent reviewer: `foundation_review`, before the implementation commit on October 20, 2026.

Scope: scoped request scheduling and deduplication, local field/structural generations, shared cancellation ownership, GraphQL AbortSignal bridging, latest-attempt errors, regressions, documentation, Changeset, and packed-library validation.

Review findings and fixes:

- A newer ordinary ancestor error did not reserve a subtree barrier, allowing an older sibling response to clear its metadata. Accepted errors now reserve generation barriers, and a regression verifies that the newer error and cached value survive.
- An `ensure()` waiting on a superseded read rejected even if newer work had satisfied the view. It now recomputes coverage after supersession, while real failures reject promptly even when other reads remain pending. The same rule applies when automatic acquisition or `ensure()` started the superseded request itself.

The reviewer cleared the final candidate with no remaining actionable findings, independently passing all 19 core and 4 GraphQL concurrency tests (including real HTTP cancellation) and `git diff --check`. The test for superseding automatic acquisition uses invalidation to make the original request obsolete; an identical refresh correctly deduplicates and would not exercise that case.

The parent passed final `pnpm check`: formatting, builds, generated-schema verification, strict TypeScript checks, 130 tests (16 tooling, 58 core, 4 fixture API, 6 Apollo baseline, 46 GraphQL), and isolated ESM/TypeScript consumers installed from the actual tarballs. Packed runtime checks exercise supersession and cancellation, and packed type checks cover exported signal/context/error contracts.

The implementation preserves mark-only invalidation freshness, validates responses before filtering stale generations, rejects unsafe older structural replacements conservatively, and ignores late writes after final-owner cancellation. Local generations do not claim authoritative server ordering. Retries, timed retention, and public stream ingestion remain future work. No package was published; release readiness remains disabled.

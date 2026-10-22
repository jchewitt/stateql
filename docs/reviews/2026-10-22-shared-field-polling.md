# B6 shared field polling review

Independent reviewer: `/root/freshness_review`, October 22, 2026. Separate implementation agents authored the core test suite and Angular/GraphQL/JavaScript integration. The primary agent implemented runtime coordination and documentation. No agent committed before independent review.

Scope: explicit owner interests, canonical selection grouping and cadence, inherited configuration, shared acquisition/retry/deadline behavior, disposal, Angular binding delegation, GraphQL native timing, packed JavaScript/type consumers, Changeset and documentation.

Before final review, the primary agent corrected dispatch races: a stopped duplicate registration cannot suppress a surviving same-owner interest, and a stopped queued tick cannot reserve error ordering that hides a pending manual error. The test agent added deterministic regressions, including an older polling error arriving after a newer manual outcome. The independent reviewer re-reviewed those fixes and found no outstanding actionable runtime findings. They identified an invalid relative endpoint and an incorrect Angular state label in the guide; both were corrected, and the owned-query paragraph was moved to its appropriate section.

The independent reviewer passed 27 core polling tests, three GraphQL polling tests, 16 Angular query tests and `git diff --check`, then approved the candidate. The parent passed `pnpm check`: formatting, builds, generated-schema verification, strict source/type/checked-JavaScript checks, 399 tests, and isolated real-tarball ESM/TypeScript/Angular APF/AOT consumers. The full browser suite passed all 25 scenarios. Initial sandbox validation could not connect to its local HTTP fixtures (`EACCES`); the network-enabled rerun passed without a runtime change.

The Changeset queues all three packages for the existing batched alpha release. No package versions, release policy or publication permissions change. B7's typed results, application trials, performance/memory evidence and beta-readiness review remain open. Hosted CI evidence belongs to the feature PR.

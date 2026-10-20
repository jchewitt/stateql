# P3.7 bounded read retries review

Independent reviewer: `foundation_review`, before the implementation commit on October 20, 2026.

Scope: portable retry policy/scheduler contracts, shared attempt budgets, cancellation and supersession, generation-filtered terminal field errors, GraphQL HTTP classification/native timers, behavioral tests, packed consumer, Changeset, and E1/E4 roadmap additions.

The reviewer assessed the design before implementation and recommended a client-level policy so owners of a deduplicated request cannot supply conflicting retry budgets. Runtime review found one P2 issue: connection loss after successful HTTP headers bypassed transport classification during response-body consumption. The fix separates body transfer from JSON parsing: failed transfers may retry, while fully received malformed JSON remains terminal.

The reviewer re-reviewed the fix, passed all 12 core and 10 GraphQL retry tests independently, and reran the original real HTTP post-headers disconnect reproduction. It now succeeds after one retry. Final candidate approval reported no remaining actionable findings; documentation, Changeset, packed-consumer coverage, and diff checks were also reviewed.

The parent passed `pnpm check`: formatting, builds, generated-schema verification, strict TypeScript checks, 152 tests (16 tooling, 70 core, 4 fixture API, 6 Apollo baseline, 56 GraphQL), and isolated ESM/TypeScript consumers installed from actual tarballs. Packed checks exercise the retry policy, exported contracts, and successful recovery.

The implementation does not retry writes or claim bounded request duration. Timeouts, retention timers, narrower policy inheritance, and streaming remain future work. The roadmap records server invalidation/data modes and an adapter-based server companion, with a user discussion before streaming implementation. No package was published; release readiness remains disabled.

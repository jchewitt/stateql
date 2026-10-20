# P4.3 StateQL demo views review

Independent reviewer: `foundation_review`, before the implementation commit on October 20, 2026.

Scope: StateQL mode beside the Apollo baseline, central and feature-derived definitions, generated schema output, shared fixture controls and request inspector, Angular query ownership and tenant replacement, explicit field versus list refresh, clean-checkout startup, tests, and documentation.

The initial review found no blocking issues. A minor action-status edge case could display an older action's outcome after switching A → B → A. The final candidate uses a scope generation guard and a deterministic browser regression that delays the fixture action response across those switches. The reviewer rechecked the fix and test and cleared the final candidate with no remaining actionable findings.

The reviewer independently passed all 8 demo Node tests and the demo's Angular/type checks, and reviewed the final documentation and desktop screenshot. The parent passed `pnpm check`: formatting, production builds, generated-schema checks, strict types, 188 tests (16 tooling, 81 core, 4 API, 56 GraphQL, 2 vanilla, 21 Angular, 8 demo), and isolated packed-package consumers including APF/AOT. The additional browser regression was type-checked separately; all 9 browser cases passed. Final formatting and diff checks passed. Desktop and mobile screenshots were visually inspected.

Evidence covers one shared initial read, smaller feature projections, missing-field acquisition when the feature mounts first, generated narrow requests, retained cached siblings, explicit list order replacement, failure recovery, owner remount, tenant switching during a read, reset of all tenant caches, and mobile layout. The original Apollo browser cases remain passing.

This changes private demo applications, generation tooling and documentation, not library package behavior or APIs, so no Changeset is required. Both clients are bundled in the lab; its total bundle is not a package-size comparison. StateQL forms and the complete parity matrix remain P4.4/P4.5. npm readiness and publication configuration remain disabled and unchanged.

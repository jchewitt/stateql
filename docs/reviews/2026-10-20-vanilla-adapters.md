# P3.8 vanilla consumers and adapter review

Independent reviewer: `foundation_review`, before the implementation commit on October 20, 2026.

Scope: provisional acquisition patch ingress, shared reconciliation/commit path, record-specific local ordering, dynamic GraphQL schema typing, native JavaScript/TypeScript examples, fake whole-resource/event sources, isolated packed-package checks, Changeset, and documentation.

The reviewer assessed the ingress and typing design before implementation. Runtime review independently passed 11 ingestion tests, two native example tests, checked-JavaScript/TypeScript example checks, GraphQL negative type checks, and core type checks. It confirmed validation before generation changes, preservation of unaffected records/fields, structural barriers, retry suppression, and strict explicit-model typing. No actionable runtime findings remained.

Final documentation review found a relative endpoint example unsupported by the current HTTP transport. It was changed to an absolute localhost URL and re-reviewed. The reviewer cleared the final candidate with no remaining actionable findings, contingent on the full check passing.

The parent passed `pnpm check`: formatting, builds, generated-schema verification, strict TypeScript and checked-JavaScript checks, 165 tests (16 tooling, 81 core, 4 fixture API, 6 Apollo baseline, 56 GraphQL, 2 vanilla examples), and isolated consumers installed from actual tarballs. Package validation executes native JavaScript and compiled TypeScript examples with no TypeScript package installed in the consumer, then checks their types using the repository compiler.

Patches require an active acquired resource and existing record identities; they cannot change membership. The event example is in-process, with local ordering only. Production streaming, server revisions, reconnect/replay, and offline recovery remain future milestones. JavaScript consumers still supply runtime schema knowledge; generated TypeScript models are optional. No package was published.

# Keyed-list reconciliation review

Independent reviewer: `foundation_review`, before the P3.4 commit on October 19, 2026.

Scope: collection capability, identity-based narrow patches, missing/new member handling, shared membership freshness and fetching, explicit membership replacement, validation, lifecycle, documentation, demo, and packed consumers.

The reviewer found that missing scalar values on ignored new records or fetched-only fields could escape validation: undefined object properties had already been omitted during input snapshotting. The reconciliation layer now validates every write value before filtering or committing. A regression covers both cases and verifies that the response cannot partly update existing records. The reviewer rechecked the fix and approved with no remaining actionable findings. It independently ran all ten core list tests and three GraphQL list tests, including real HTTP. A wording ambiguity about added-only membership changes was also corrected.

After the fix, the parent ran the full `pnpm check`: formatting, builds, generated schema, strict types, 89 tests (16 tooling, 35 core, 4 fixture API, 6 Apollo baseline, 28 GraphQL), and isolated tarball ESM/TypeScript consumers passed. `pnpm demo:acquire` produced five HTTP requests: field refresh preserved INV-1/INV-2 order and cached amounts; explicit list refresh adopted INV-2/INV-1 and current amounts 14000/13500.

P3.4 covers keyed root lists. Unkeyed and nested object lists remain unsupported. Partial GraphQL errors, general concurrent scheduling/cancellation, retry policy, and StateQL Angular integration remain later tasks. No npm release is enabled.

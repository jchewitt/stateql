# Automatic acquisition review

Independent reviewer: `foundation_review`, before the P3.2 commit on October 17, 2026.

Scope: portable acquisition coordinator, cache/missing-field selection, lifecycle handling, GraphQL response validation, default HTTP transport, integrations, example, and package consumers.

The reviewer found a cross-consumer snapshot ordering bug: query wrappers could expose their previous snapshot inside another consumer's callback. Active reads now synchronize with the committed underlying view while separate notification bookkeeping prevents skipped notifications. The regression collects observer exceptions and asserts outside callbacks so it cannot pass by swallowing an assertion failure.

The reviewer rechecked the fix and cleared P3.2 with no remaining blockers. It independently ran all four core acquisition tests and nine GraphQL acquisition tests, including real HTTP; all passed. The parent also exercised `pnpm demo:acquire`, which produced two requests for three consumers: the initial account-ID read and an additional amount-only read, each with identity/context.

The final full `pnpm check` is required before commit. This completes acquisition for the documented response subset, not the remaining invalidation, general reconciliation, concurrent generations/cancellation, retries, or Angular integration tasks. No npm release is enabled.

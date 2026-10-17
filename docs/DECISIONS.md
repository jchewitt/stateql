# Architecture decisions

## D001 GraphQL first with an execution boundary

One schema-informed definition drives selection, canonical state addresses, and GraphQL generation. The boundary lies where a planned selection becomes an executable operation. GraphQL is the default assembled experience. Keep the source interface internal during the proof of concept. Future REST and event adapters must not force a second query language or mapping model into the default flow.

## D002 Framework-independent observation

Core exposes immutable snapshots and subscriptions without Angular, React, or RxJS. The first exported types describe observation and disposal only; they do not claim to implement a cache. Angular is the first adapter. React and richer Observable integration are later work.

## D003 Identity and partial updates

State identity includes scope, canonical path, and arguments; request fingerprints can vary by selection without producing separate stored state. Lists need reliable record identity for selective merging. Field refresh and membership refresh have different semantics. Refer to `PLAN.md` for null/error and race rules.

## D004 Foundation tooling

Use a pnpm workspace, strict TypeScript, ESM and declarations, native Node tests for the current tooling, and a real tarball-consumer check. Add the runtime-specific test framework only when its implementation needs warrant it. Reserved modules have documentation rather than empty publishable packages. Add Angular Package Format tooling with the actual Angular implementation.

## D005 Releases

Use MIT. Track versions and changelogs with Changesets. The first npm releases must be prereleases on `next`, manually dispatched from a reviewed version tag contained in `main`. Use npm OIDC trusted publishing with provenance after external account configuration. A tracked readiness flag prevents releasing the scaffold.

The GitHub repository belongs to verified personal account `jchewitt`. npm authentication and scope ownership have not been established; `@jchewitt/stateql-core` is a provisional identifier, to be confirmed or changed before any release.

## D006 Review before commit

Every commit requires independent agent review and resolution of actionable findings. CI is complementary verification, not a substitute for the review. Future feature work uses branches and pull requests; the initial reviewed foundation is the bootstrap commit on `main`.

## D007 Planner prototype boundary

Generate TypeScript schema types and embedded SDL together. Keep canonical addresses and immutable resolved selections in core; schema coercion, AST construction, validation, and identity injection belong in the GraphQL package. Keep that package private until the runtime exercises its interface. The supported schema subset and item-projection type contract are explicit in `PLANNER.md`; unsupported features fail rather than silently approximate their behavior. Source/scope are explicit binding inputs until a runtime client owns them.

## D008 Shared storage before execution

Implement P3 in reviewable increments. P3.1 introduces an adapter-facing atomic commit store with explicit membership, canonical field paths, immutable consumer projections, and lifecycle ownership. A later coordinator decides response eligibility, missing-field acquisition, cancellation, and retries; a source decoder translates protocol responses into store changes. Do not interpret the store's explicit membership replacement as permission to replace membership from a narrow response. The store interfaces remain provisional and are documented in `STORE.md`.

## D009 Acquisition before concurrent refresh

P3.2 serializes reads per resource and recomputes missing fields after prior work. GraphQL decoding initially rejects partial errors, unsupported structures, and membership changes explicitly. This permits an executable cache acquisition slice without implying P3.3–P3.6 reconciliation and race semantics are finished. Source reads return decoded records to core; HTTP and response validation remain in the GraphQL package. The eventual concurrent scheduler must preserve current cache reuse and lifecycle behavior.

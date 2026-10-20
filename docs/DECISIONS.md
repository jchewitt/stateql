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

## D010 Selective refresh over the serialized coordinator

P3.3 adds field/branch invalidation and refresh using the same canonical selection and state address. GraphQL handle targets are inferred from the bound definition, including aliases. A source may declare broader fetched coverage within its selection; only requested field writes commit, with required ancestor structure. Successful nulls or changed object identity must still discard obsolete descendants. Invalidations arriving during a read are reapplied atomically with that older response, including before initial membership is known. This is protection for the current serialized scheduler, not completion of P3.6 concurrent generations, cancellation, or in-flight refresh deduplication.

## D011 Explicit keyed-list reconciliation

P3.4 uses `refreshList()` for membership/order replacement; no-argument `refresh()` and `invalidate()` remain field operations over the declared selection. Collection sources opt in, with GraphQL deriving that capability from the resource field. Narrow reads patch only matching identities, ignore newcomers, retain missing records, and flag shared membership as stale. Missing records keep requested fields stale and reject the refresh as incomplete after valid matching writes commit. Only explicit membership replacement clears the membership flag. A list refresh uses the caller's entire selection and rejects incomplete responses before changing membership. Other views may need `ensure()` to fill additional fields on newly admitted records. Unkeyed lists and nested object lists remain unsupported rather than being approximated with positional identity.

## D012 Planned stream, ordering, and offline capabilities

Add E1 stream cohesion, E2 revision-aware ordering, and E3 framework-independent offline recovery as explicit product goals, with contracts and acceptance criteria in `PLAN.md`. They remain future work after the initial comparison; protect the common validation/commit boundary in P3.6/P3.8. Stream adapters declare payload meaning and routing. Cross-transport ordering requires comparable authoritative revisions and distinguishes replacement values from dependent deltas; timestamps alone do not establish absolute consistency. Offline cache persistence and a durable command outbox are separate features. Composition syntax is not a journal; replay requires serializable commands, server idempotency, and explicit conflict policy. Evaluate reductions in application coordination against existing Apollo normalization/subscription/persistence capabilities without claiming those mechanisms are unique to StateQL.

## D013 Partial execution results and structural nulls

P3.5 maps GraphQL execution-error paths against the generated operation and schema before any commit. Successful requested fields commit alongside located failures; scalar failures retain cached values with shared errors, while failed object nulls clear descendants and carry errors. Omitted fields preserve values but remain stale/incomplete for acquisition. Resource/ancestor nulls become `records: null` with shared `resourceError` when failed, distinct from unknown (`undefined`) and empty (`[]`); a successful singleton identity replacement discards the previous record. Sources return portable field failures or an explicit null-resource result, keeping GraphQL outside core. Malformed/unlocatable errors and null list items without identity reject atomically. A failed explicit list refresh can patch known members but cannot replace existing array membership; an initial acquisition or recovery from null can establish identified records with field errors. Omissions during list refresh still reject before any commit. Serialized reads, handle attempt errors, and pending invalidation semantics remain in place until P3.6.

## D014 Concurrent reads with local generations and owned cancellation

P3.6 supersedes serialized forced execution with a scheduler per resource. Exact current requests share work; `ensure` waits for useful coverage and recomputes after supersession. New requested-field generations block older overlapping writes, while disjoint changes can commit. Structural nulls, changed identities, ancestor errors, and membership replacement protect wider subtrees; an unsafe older root replacement is rejected conservatively. Mark-only invalidation still lets older data populate but cannot become fresh from that response. Superseded forced reads reject explicitly, and handle errors track the latest invoked attempt.

Active interested handles jointly own work. Final-owner departure cancels immediately; disposed callers settle even when a source ignores cancellation. Core exposes a portable signal, while GraphQL bridges it to native AbortSignal and HTTP fetch. Retention timers and retries remain separate work. These are local ordering guarantees, not server revisions or a cross-transport consistency protocol. See [the detailed contract](CONCURRENCY.md).

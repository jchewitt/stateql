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

October 20 update: the user selected `@launch-echo` for the core, GraphQL and Angular release set. Existing manifests still use `@jchewitt`; R1 migrates all references together and verifies npm scope access. Exact versions and multi-package publication remain pending.

October 21 update: R1 migrates the complete release set to `@launch-echo` and prepares `0.1.0-alpha.0` on `next`, with one `stateql-v<VERSION>` tag and fixed Changesets release group. The user performs the first interactive publication of reviewed tarballs, then configures trusted publishing for subsequent versions. Local bootstrap has no GitHub provenance. CI uses OIDC/provenance and cannot treat that bootstrap as a provenance-bearing release. Publication checks the entire set before mutation, publishes in dependency order, and only skips existing versions whose integrity matches. GitHub workflow/source revision equality remains mandatory. Registry installation acceptance and account access cannot be inferred from local checks; see [the handoff](RELEASING.md).

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

## D015 Read retry policy belongs to shared acquisition

P3.7 adds an immutable client-level policy and injected scheduler. Each shared request has one bounded retry count and keeps its original generations and owners through backoff. GraphQL supplies two retries and native timers by default; portable core remains opt-in. Only explicitly classified transport failures retry. HTTP request construction, fully received JSON parsing, GraphQL decoding, and cache reconciliation stay outside transient network classification. Terminal transport errors preserve values and mark only generation-eligible requested fields; missing/null/empty resources retain their shape and surface handle errors. Client/owner cancellation and supersession prevent more attempts.

Per-consumer overrides would need a conflict rule for shared work and are deferred. Timeout, retention, polling, and write replay remain separate contracts. See [retry details](RETRIES.md).

## D016 Server-driven invalidation and data updates

The October 20 direction expands E1 into configurable invalidation-only and direct-data modes, with optional WebSocket/SSE delivery and client-only fallback. E4 tracks a separate server event companion with business-event/database-change input adapters, declared routing/projection, and delivery adapters. Invalidation hashes do not establish ordering; inactive resources, missed events, and reconnect require explicit token retention and revalidation. Publishing committed changes, authorization, authoritative revisions, and durable delivery need server contracts. Notify the user and discuss this design before E1 implementation; preserve the boundaries now without prematurely building server dependencies into core.

## D017 Vanilla consumers and provisional adapter ingress

P3.8 proves the transport boundary with a whole-resource source and an in-process event adapter. `AcquisitionClient.ingest(source, patch)` accepts fully validated, nonempty patches to known records with active owners and established membership. It shares reconciliation and the generation/commit/notification path with reads, records barriers per changed record/field, and cannot change membership. Invalid patches do not advance ordering. Adapters own decoding, scope binding, and listener cleanup; this is not a production stream protocol or server revision policy.

TypeScript is an implementation and optional consumer tooling choice. Ship ESM JavaScript plus declarations, support dynamic `createSchema(sdl)` with runtime schema validation, and retain strict explicit-model/generated-model overloads. No TypeScript runtime or code generation is required to consume the library. Runtime schema knowledge remains required; dynamic names do not imply compile-time schema guarantees. Validate actual installed tarballs with native JavaScript, compiled TypeScript, and checked JavaScript examples. See [the runnable contract](VANILLA.md).

## D018 Angular observation before owned query integration

P4.1 adds a private APF package built with ng-packagr in partial compilation mode, with Angular core and StateQL core peers. `stateqlSignal` adapts a portable reader to a readonly signal and owns only its subscription. Injection-scope destruction unsubscribes without disposing shared readers/clients. Reject construction inside reactive computations and destroyed scopes; preserve snapshot identity and close the read/subscribe gap. P4.2 remains responsible for providers, handle ownership, and reactive argument replacement. Validate installed tarballs with native ESM and Angular AOT template compilation.

## D019 Drafts and commands are separate from server state

The October 20 forms direction reinforces editor-local drafts, not another shared cache. Preserve baseline/draft/latest values and capture immutable submitted values plus edit generations on explicit Save. Typing neither publishes cache changes nor sends socket commands. Reconcile confirmed saves without losing newer edits, and distinguish failed refresh from failed or ambiguous command acknowledgement. Scope/record identity binds drafts and outcomes. Start with a small demo binding using the same policy for both clients; defer a library forms abstraction, optimistic overlays, persistence, and durable outbox until their contracts are exercised. See [the full forms contract and limits](FORMS.md).

## D020 Angular clients and query views have separate ownership

P4.2 uses a typed application InjectionToken and an environment provider factory, keeping GraphQL out of the Angular runtime package. The provider owns one client per providing injector. `injectStateQuery` tracks a pure parameter getter, opens fresh owned handles untracked in the chosen injection context, and releases replaced handles without disposing the provider's client. Descriptor identity gates state and commands before effect-driven replacement, so a new account cannot expose or refresh the previous binding. Disposed views stop parameter evaluation. Parameter/factory failures are separate from active snapshot transport errors.

The owned query and non-owning signal bridge share the same guarded subscription primitive. Core continues to own cache reuse, deduplication, cancellation and invalidation. No form draft writes or command transport are introduced. See [API, scheduling, and lifecycle rules](ANGULAR.md).

## D021 Continue the independent runtime as an experiment

P5's [recorded comparison](COMPARISON.md) demonstrates equal narrow response payloads, fewer authored read-selection declarations, mixed UI/adapter coordination counts and smaller representative consumer bundles at the cost of runtime schema/operation planning. Continue toward a three-package experimental alpha, not a claim of general superiority over Apollo. Requested/fetched/committed coverage, per-field freshness/errors and separate membership refresh are runtime contracts that a planner alone would not supply. A planner over an existing cache remains a fallback if those semantics do not earn their maintenance cost in real applications.

Track typed runtime projection, larger-workload measurements, safe plan reuse, retention and timeout contracts separately. No premature optimization or new runtime framework is justified by the small desktop timing sample. Preserve P6 and the E1/E2 boundary, including the promised user discussion before implementing streams. R1 must finish multi-package publishing and account configuration; completing P5 does not enable publication.

## D022 Consistent client/server configuration with injectable capabilities

The approved product direction uses the same recognizable setup sequence on client and server: create/inject infrastructure, register providers, choose global defaults, assign resource groups, then apply resource overrides. Reuse portable resolution/ownership primitives where semantics match without imposing identical role-specific interfaces or a NestJS dependency. Global means one runtime/application instance. Registration does not enable all capabilities; omitted settings inherit and explicit disable settings stop inheritance. Start with one primary group per resource and reject conflicting authority/identity/scope bindings. Groups configure resources without changing their state identity.

Custom and official adapters follow the same capability contracts, validation and lifecycle rules. Acquisition, transport, routing, checkpoint storage, retained replay and commands remain distinct. Shared connections may serve separate immutable bindings; disposing one binding never closes borrowed infrastructure or another owner's work. Keep default GraphQL setup simple, server dependencies out of browser builds, and extension interfaces provisional until exercised by working implementations. See [the full contract](../PLAN.md#consistent-client-and-server-adapter-configuration).

## D023 Recoverable optional end-to-end flow

Database/business changes may flow through resource-specific authorized projections to clients; reverse flow is a local draft, explicit command, validated server commit and authoritative acknowledgement/event. Developers choose paths and streaming-off, invalidation-only or data-sync modes per resource. Reconnect prioritizes active demand, including background consumers and pending commands; framework visibility is only a priority signal. Baselines and stream resume points must be coherent, with bounded replay/buffering and fresh-baseline fallback when history expires.

Use coordinated authoritative revisions by default, distinguish them from replay cursors, and track covered fields/membership without assuming a whole record is current. Vector clocks remain a possible advanced independent-writer extension. A replacement server instance must recover through shared history/checkpoints or an authoritative baseline; process-local sequence numbers cannot supply this guarantee. Redis persistence, live messaging and retained history are separate capabilities. Socket.IO integrations borrow existing client/server infrastructure and reuse its transport recovery while StateQL owns application-state reconciliation. Streaming-off mode remains supported throughout. E1.0 now reviews concrete protocol choices against this agreed direction before implementation.

## D024 Publish usable increments

Publish the standalone client foundation first, then complete client lifecycle/configuration, recoverable live state with a minimal server companion, optional infrastructure integrations, persisted reads, and finally opt-in durable commands. Stages may split into smaller releases when each provides a complete vertical slice. Server/client setup must use the same vocabulary, precedence and ownership rules, with paired examples and contract tests. Every release works without a future release or hosted service, keeps previous standalone use cases working, and documents experimental API migrations. No empty adapter/server packages, new runtime behavior, scope migration or publication enablement is introduced by this planning decision. See [release gates](../PLAN.md#usable-incremental-releases) and [tasks](TASKS.md).

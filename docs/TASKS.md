# Tandrove task breakdown

Complete each chunk with its focused tests, independent agent review, and a passing `pnpm check`. Keep later package APIs internal until a concrete use case exercises them. P1–P5 are complete; R1 is the next delivery. Later work follows [usable incremental releases](../PLAN.md#usable-incremental-releases), with a runnable vertical slice at every publication and continued support for standalone client operation.

## F0 Repository foundation

- [x] F0.1 Verify personal GitHub ownership, create the public repository, and choose MIT.
- [x] F0.2 Create the pnpm/TypeScript workspace and portable observation contracts.
- [x] F0.3 Add type checks, tooling tests, package build, and isolated tarball-consumer validation.
- [x] F0.4 Add Linux/Windows CI, pinned action references, and dependency update configuration.
- [x] F0.5 Add Changesets and an explicitly gated npm prerelease workflow.
- [x] F0.6 Capture architecture decisions and implementation tasks.
- [x] F0.7 Complete independent review, fix findings, and pass local checks. See the [review record](reviews/2026-10-16-foundation.md).
- [x] F0.8 Commit and push the reviewed foundation; the [first hosted CI run](https://github.com/jchewitt/stateql/actions/runs/38964030997) passed on Linux (Node 22 and 24) and Windows (Node 24).

Exit: repository is cloneable and locally verifiable; hosted CI passes; release/account prerequisites are documented.

## P1 Shared fixture server and Apollo baseline

Depends on F0. Implemented; see the [demo guide](DEMO.md) and automated scenarios.

- [x] P1.1 Add the minimal Node GraphQL billing server with schema, in-memory fixtures, reset controls, configurable latency, and deterministic failures.
- [x] P1.2 Define scoped billing/invoices paths, invoice IDs, a nested user field, and one save mutation.
- [x] P1.3 Add an Angular demo with two consumers using idiomatic Apollo and reusable fragments.
- [x] P1.4 Implement both normal refetch and a narrow field query that merges through Apollo's cache.
- [x] P1.5 Add request inspection and scenario evidence: selected fields, variables, request count, and shared updates.

Exit: two consumers update correctly from a narrow request; reordering fixtures and switching accounts do not corrupt data. This establishes the comparison before Tandrove is measured.

## P2 Typed definitions and GraphQL operation generation

Depends on P1's schema. Implemented; see the [planner guide](PLANNER.md).

- [x] P2.1 Implement the smallest schema-generation path needed for typed nested selections and ancestor arguments.
- [x] P2.2 Define immutable select/extend behavior, reject incompatible overrides, and test inferred result types.
- [x] P2.3 Derive canonical addresses from scope/path/arguments; resolve an alias to the same canonical field.
- [x] P2.4 Generate variable-based GraphQL operations from a selected subtree; include required item identity/context.
- [x] P2.5 Validate documents against the fixture schema; reject unsupported schema features explicitly.

Exit: changing an invalidation target needs no separately maintained query or mapping; type tests reject unknown fields and invalid arguments.

## P3 Shared state and selective invalidation

Depends on P2.

- [x] P3.1 Implement shared records, consumer projections, stable snapshots, subscriptions, and disposal. See the [store guide](STORE.md); execution and reconciliation remain below.
- [x] P3.2 Implement cache hit/miss and missing-field acquisition across compatible views. See the [acquisition guide](ACQUISITION.md) for the supported subset and remaining reconciliation work.
- [x] P3.3 Implement field/branch invalidation and requested/fetched/committed coverage. See [invalidation semantics](ACQUISITION.md#selective-invalidation-and-refresh).
- [x] P3.4 Implement identity-based list patching separately from membership replacement. Keyed root lists support `refreshList()` and shared `membershipStale`; unkeyed and nested object lists remain outside the prototype's supported schema subset.
- [x] P3.5 Handle omitted fields, successful nulls, structural nulls, and GraphQL partial errors. Located failures preserve valid siblings; null resources and singleton identity changes clear obsolete data. Null list entries without identity remain explicitly unsupported.
- [x] P3.6 Implement in-flight deduplication, field generations, cancellation ownership, and late-response protection. See the [concurrency contract](CONCURRENCY.md); these are local request generations, not authoritative server revisions.
- [x] P3.7 Add bounded read retries and field error state; keep writes outside automatic retries. See [retry policy, classification, and lifecycle](RETRIES.md).
- [x] P3.8 Demonstrate native JavaScript and TypeScript consumers plus fake whole-resource and push-event adapters. See [the examples and provisional ingestion contract](VANILLA.md); isolated package checks run without a TypeScript runtime.

Inactive cache data is currently retained until client disposal. Configurable retention and request timeout timers remain follow-on lifecycle work; bounded attempts do not bound an individual request's duration. Narrower policy inheritance also remains deferred until conflicting owners of shared work have defined semantics.

For P3.6/P3.8, keep local request generations separate from future server revision metadata, and route simulated pushes through the shared validation/commit path. This preserves the E1/E2 boundary without implementing a production stream protocol or offline outbox in the current proof of concept.

Exit: the relevant acceptance matrix in `PLAN.md` passes, including invalidation during an existing fetch and response reordering.

## P4 Angular integration and forms

Depends on P3.

- [x] P4.1 Add the actual Angular library, appropriate peer dependencies, and Angular Package Format build/pack checks. A non-owning readonly signal bridge is implemented; see [the Angular guide](ANGULAR.md).
- [x] P4.2 Implement DI, signal snapshots, reactive argument replacement, and destruction cleanup. Typed client providers own the client; owned query views gate obsolete snapshots/commands and release only their handles. See [the Angular contract](ANGULAR.md).
- [x] P4.3 Add Tandrove views beside the Apollo baseline with central and feature-derived definitions. Both modes use the shared fixture inspector; Tandrove demonstrates narrow field refresh, explicit list refresh, scoped arguments, and owned consumers. Focused browser coverage is included; P4.4/P4.5 below add the forms/parity matrix. See [the demo guide](DEMO.md).
- [x] P4.4 Demonstrate isolated form drafts, pristine-field refresh, dirty conflicts and explicit save with targeted invalidation. Apply the [forms contract](FORMS.md): immutable submitted payloads, edits during save, confirmed-save/failed-refresh distinction, reset to latest server data, scope/record isolation, unavailable records, and no automatic write retries.
- [x] P4.5 Add browser tests for shared updates, narrow requests, account switching, errors, and cleanup; cover the P4.4 draft/save cases with the same policy for Apollo and Tandrove.

Exit: the same fixture scenarios pass in both implementations and the adapter contains no second cache engine.

Form drafts remain editor-owned, separate from shared accepted server state and pending commands. Angular controls provide local storage; the proof of concept does not add another global cache or a forms framework. P4.1 exposes read-only observation, and P4.4 implements the editing policy with P4.5 browser verification. Real socket commands and authoritative revision conflicts remain E1/E2/E4.

## P5 Compare and choose the next scope

Depends on P4.

- [x] P5.1 Compare application declarations and coordination code separately from generated and dependency code.
- [x] P5.2 Record actual payloads, operation counts, package cost, and planning overhead without relying on artificial network delay as a benchmark.
- [x] P5.3 Document correctness boundaries and decide: continue independent runtime, narrow to a planner over an existing cache, or redesign.
- [x] P5.4 Update the README with demonstrated behavior and a working demo guide.

Exit: a concrete evidence-backed decision, rather than an unsupported claim of superiority over Apollo.

Completed comparison: [method, measurements and decision](COMPARISON.md). Run `pnpm compare` to reproduce local artifacts. Continue the independent runtime as an experimental library: simpler selection-derived refresh and explicit field/membership semantics justify further work, while payloads match Apollo and runtime planning has a measurable cost. No general speed or feature-parity claim is made.

### Follow-up findings from P5

- [ ] Add a typed runtime result projection while preserving partial/missing/error states; current generic snapshots add presentation narrowing code.
- [ ] Measure larger schemas, record counts, browser memory and lower-powered devices before making scaling/performance claims.
- [ ] Evaluate reusable compiled operation plans with argument, scope and identity regression coverage.
- [ ] Complete P7's stale-time, inactive-retention and request-timeout contracts before presenting the prototype as production-ready.

These findings are not retroactively required to complete the initial comparison. Document limitations in R1's experimental release; schedule runtime changes in separately reviewed chunks.

## P6 Field polling

Depends on a continue decision in P5.

- [ ] P6.1 Add explicit interval units and owner-bound polling interests.
- [ ] P6.2 Share identical interests and avoid overlapping poll/retry chains.
- [ ] P6.3 Apply A1's resolved global/group/resource policies and expose field-specific failure states. Define how differing owner polling interests combine; do not give each consumer an incompatible retry policy for shared work.
- [ ] P6.4 Test fake-clock cadence, fastest-owner departure, retries, and final-owner disposal.

## P7 Standalone client timing and retention

Stage B follow-on to R1; coordinate configuration with A1. Each implemented capability may ship separately with its complete lifecycle contract. These timers are not implemented by the current retry-count configuration.

- [ ] P7.1 Define per-field stale time, inactive retention and request deadline as distinct policies with explicit units and disable/inheritance behavior.
- [ ] P7.2 Implement freshness expiry and on-demand/active revalidation without treating a stale value as absent or manufacturing a stream dependency.
- [ ] P7.3 Evict inactive state under bounded retention while preserving active owners and isolating tenant/schema contexts.
- [ ] P7.4 Implement shared-request deadlines with explicit retry interaction; one owner's disposal must not cancel another owner's valid work.
- [ ] P7.5 Test expiry, reacquisition, final-owner cleanup, shared work, retry/deadline races and disposal with deterministic clocks; demonstrate normal client use with all streaming disabled.

## A1 Consistent provider and resource configuration

Stage B, with paired server examples completed as part of stage C. See [the shared architecture contract](../PLAN.md#consistent-client-and-server-adapter-configuration). Reuse portable implementation primitives where semantics match; keep different client/server responsibilities in separate interfaces.

- [ ] A1.1 Implement provider tokens with supplied instances and sync/async factories, explicit runtime scope and optional framework DI bridges. Plain JavaScript must not require a DI container.
- [ ] A1.2 Separate provider registration from assignment; resolve immutable global defaults → one primary resource group → resource overrides, with explicit disabling and conflict diagnostics.
- [ ] A1.3 Keep groups out of state identity; reject incompatible authority/identity/scope bindings and define conflicts for owners of shared scheduled work.
- [ ] A1.4 Define small capability-specific contracts as real implementations arrive: acquisition/decoding, transport, event routing, checkpoints, replay history and commands. Validate requested capabilities before starting work.
- [ ] A1.5 Share connections safely across bindings; test owned versus injected infrastructure, reference cleanup, initialization failure and resource disposal without cross-resource teardown.
- [ ] A1.6 Prove official and user-supplied implementations use the same validation/commit boundaries and require no core edits. Preserve simple default GraphQL setup and installed JS/TS consumers.
- [ ] A1.7 Add parallel client/server setup examples and contract tests for registration, groups, overrides, initialization, diagnostics and disposal when the server vertical slice ships. Test browser/server dependency isolation.

## A2 Optional infrastructure and source integrations

Stage D after the recoverable live-state slice, independently releasable per useful integration. Adapter package names remain provisional; publish no empty shells.

- [ ] A2.1 Add a Socket.IO client/server transport integration using the existing connection/namespace, isolated handlers and borrowed ownership. Reuse transport reconnect/recovery signals; failed recovery triggers Tandrove resynchronization.
- [ ] A2.2 Pass shared streaming/recovery scenarios using official defaults and an application-owned/custom transport without changing core. Document protocol compatibility and optional peer dependencies.
- [ ] A2.3 Add Redis-backed checkpoint storage, live distribution and retained-history capabilities with separate contracts, shared infrastructure where safe, and global/group/resource assignment. Validate retention/replay/durability capabilities explicitly.
- [ ] A2.4 Demonstrate reconnect to another server instance using shared history or authoritative baseline; cover epoch changes, expired history, authorization, cleanup and bounded backpressure. Document transport-specific load-balancer requirements separately.
- [ ] A2.5 Implement a production REST source with explicit endpoint/field mappings and requested/fetched/committed coverage; test structural nulls/deletion/identity changes and demonstrate a standalone HTTP-only application.
- [ ] A2.6 Publish each completed optional integration with installed-package examples, compatibility/migration notes, custom-provider tests and a streaming-off regression. Server libraries must not enter browser bundles.

## R1 First experimental npm release

Depends on a useful implemented package, P5, and registry setup.

Stage A publishes the implemented foundation, independently usable before any server/hosting integration. The selected packages are `@tandrove/core`, `@tandrove/graphql` and `@tandrove/angular`, with initial candidate `0.1.0-alpha.0` on `next`. The [release handoff](RELEASING.md) separates completed preparation from account-owner bootstrap, trusted publishing and registry acceptance. Alpha.0 is published and verified with installed consumers; alpha.1 passed trusted publication, provenance and installed-consumer acceptance.

- [x] R1.0 Notify the user when P4/P5 and package acceptance are complete, identify the release packages/versions, and provide the exact trusted-publisher configuration for the user to set up. The October 21 handoff is documented in `RELEASING.md`; the initial local publication is complete.
- [x] R1.1 Verify npm identity/access to the selected `@tandrove` scope. The account owner successfully published all three alpha.0 packages.
- [x] R1.1b Complete the Tandrove prepublication rename, review, hosted CI and a fresh `tandrove-v0.1.0-alpha.0` artifact set. Old StateQL tarballs and the old tag are superseded and must not be published.
- [x] R1.1a Migrate all three manifests, imports, peer dependencies, generated modules, fixtures, checks, Changesets configuration and release metadata together.
- [x] R1.2 Configure npm trust for all three packages after bootstrap. Current npm flow is documented; GitHub environment `npm` exists. The user configured trust and the actual alpha.1 workflow validated it.
- [x] R1.2a Implement automated CI publication for the approved release set, including dependency order, Angular APF output, version/peer checks, OIDC/provenance metadata, and safe handling of partial multi-package publication.
- [x] R1.2b Exercise the actual authenticated workflow on a subsequent reviewed alpha after bootstrap and trust setup; verify provenance attestations and registry-installed consumers.
- [x] R1.3 Add the first prerelease Changeset, changelog, compatibility requirements, and actual usage examples.
- [x] R1.4 Enable release readiness in a reviewed change; keep experimental versions on `next`.
- [x] R1.5 Validate the tagged commit, packed artifacts, independent review, and hosted CI before dispatching the release workflow. Alpha.0 passed; repeat for each candidate.
- [x] R1.6 Verify registry metadata, provenance, and a clean installation from npm after publication. Alpha.0 integrity/installation and alpha.1 CI provenance/signatures/installation passed. See [the completed CI run](https://github.com/jchewitt/tandrove/actions/runs/39658759688).
- [x] R1.7 Verify the released JS/TS and Angular examples work without server companion, Redis or streaming packages; document the supported subset, provisional extension interfaces and future compatibility/migration policy. Do not imply that demo-only forms helpers or planned timers are public features.
- [ ] R1.8 Automate one bot-maintained release PR with synchronized manifests, peers, lockfile, changelogs and examples; require current-revision review and CI, then tag and publish the exact merged commit. Implementation and local verification are in progress; exercise the hosted bot PR and publication before marking complete.

No npm publish is part of F0. The scaffold does not reserve an npm name or configure an npm account.

## E1 Real-time stream cohesion

Planned product goal; depends on P3.8 and a continue decision in P5. Design alongside E2. See [the contract and acceptance criteria](../PLAN.md#e1-real-time-stream-cohesion).

- [ ] E1.0 Notify the user before streaming implementation and review the concrete protocol/defaults against the agreed October 20 direction. The vision discussion is complete; this is a focused implementation review.
- [ ] E1.1 Define a validated, scoped event envelope and reusable routing from subscription/custom payloads to canonical resource/record/field addresses.
- [ ] E1.2 Feed pushes through the same ordering/commit/notification path as reads, without per-component cache reducers.
- [ ] E1.3 Define explicit list membership operations and safe invalidation when filter/path routing cannot be inferred.
- [ ] E1.4 Implement shared connection ownership, disposal, bounded reconnect, cursor resume/deduplication, and gap-triggered refresh.
- [ ] E1.5 Demonstrate a real GraphQL subscription plus a fake custom event source; test duplicate/malformed events, scope isolation, and HTTP/push overlap.
- [ ] E1.6 Compare application code against Apollo automatic normalized updates and explicit list updates, including required adapter mappings on both sides.
- [ ] E1.7 Add configurable invalidation-only and data-update modes over WebSocket/SSE; keep client-only invalidation/fetch behavior available without a server companion.
- [ ] E1.8 Define bounded retention of invalidation tokens for inactive resources, on-demand reacquisition, revision handshakes/replay, and gap-triggered validation.
- [ ] E1.9 Aggregate active interests from views, services and commands; treat visibility as priority, update server subscriptions where supported, and prioritize active recovery without advancing skipped coverage checkpoints.
- [ ] E1.10 Implement coherent baseline-to-stream handoff and bounded replay/buffering; distinguish delivery cursor from covered data revisions, handle expanded selections and expired history, and preserve streaming-off/HTTP fallback behavior.

Exit: ordinary field pushes update all interested consumers through one declared binding; list and reconnect semantics are explicit and tested.

## E2 Revision-aware ordering across transports

Planned product goal; depends on P3.6 and a continue decision in P5. Define the contract alongside E1; integrate its transport fixtures when available. See [ordering guarantees and limits](../PLAN.md#e2-revision-aware-ordering-across-transports).

- [ ] E2.1 Define comparable authoritative revisions, comparison domains, epochs, and explicit timestamp/unversioned-source policies.
- [ ] E2.2 Track covered field/subtree and membership revisions separately; distinguish local request generations from server revisions.
- [ ] E2.3 Reject stale overlapping updates while allowing needed independent fields; handle equal-version conflicts, structural nulls, identity replacement, and deletion tombstones.
- [ ] E2.4 Distinguish replacement snapshots from dependent deltas; implement deduplication, bounded gap handling, and authoritative resynchronization.
- [ ] E2.5 Exercise HTTP/poll/push/command-ack reordering, duplicates, missing predecessors, clock ties/skew, epoch changes, and missing revision metadata with deterministic sources.
- [ ] E2.6 Expose drop/conflict/resync diagnostics and document the conditional consistency guarantee.
- [ ] E2.7 Default to coordinated authoritative scalar revisions; document vector clocks as an advanced independent-writer extension requiring conflict policy, not a prerequisite or a graph-diff algorithm.

Exit: comparable newer data cannot be rolled back by older overlapping updates; unsupported ordering cannot silently claim success or absolute consistency.

## E3 Framework-independent offline recovery

Planned product goal; depends on a continue decision in P5. Define serialization/recovery boundaries after the E1/E2 contracts; integrate streams only once available. Persistence precedes the separate durable command queue. See [offline contracts and acceptance criteria](../PLAN.md#e3-framework-independent-persistence-and-offline-recovery).

- [ ] E3.1 Define opt-in serializable checkpoints/changes with schema versions, scope, field metadata, membership, and revision coverage; do not serialize modifier functions.
- [ ] E3.2 Add an asynchronous storage adapter and IndexedDB implementation, with migrations, atomic restore, quotas/corruption handling, and data retention policies outside core.
- [ ] E3.3 Coordinate hydration, incoming live updates, and reconnect revalidation; test plain TypeScript and Angular consumers using the same persisted representation.
- [ ] E3.4 Design a separate opt-in outbox for replayable commands with operation IDs, preconditions, dependency ordering, acknowledgement state, and recoverable failures.
- [ ] E3.5 Require server idempotency and conflict contracts for retryable writes; reconcile ambiguous acknowledgements and stream echoes without treating optimistic state as confirmed.
- [ ] E3.6 Test crash recovery, expired authorization/idempotency windows, schema changes, user switching, and multi-tab replay ownership; add later React coverage with its adapter.
- [ ] E3.7 Compare equivalent persistence and offline-write workflows, measuring integration code and documented recovery limits separately.

Exit: persisted reads recover predictably; supported queued commands replay under an explicit server contract with observable conflicts and no cross-scope execution. Do not claim effortless arbitrary replay or client-only exactly-once effects.

## E4 Adapter-based server event companion

Planned extension requested October 20, 2026; deliver the minimal usable slice with E1/E2 in stage C and distributed integrations through A2 in stage D. See [server contracts and acceptance criteria](../PLAN.md#e4-adapter-based-server-event-companion).

- [ ] E4.1 Define separate event-input, routing/projection, and delivery interfaces; keep server/database dependencies outside portable core.
- [ ] E4.2 Implement business-event input and a deterministic database-change-feed example, publishing committed changes with event IDs and revision coverage.
- [ ] E4.3 Route scoped invalidation tokens or data updates through WebSocket/SSE delivery, with server authorization and safe fallback for computed fields/filtered lists.
- [ ] E4.4 Define durable publication options, replay, backpressure, gaps, and resynchronization without promising atomic database/event delivery from ordinary callbacks.
- [ ] E4.5 Demonstrate both modes end to end, including inactive pages, deletes, duplicate/out-of-order events, reconnect, scope changes, and client-only fallback.
- [ ] E4.6 Apply A1's shared configuration primitives and recognizable setup pattern on the server, while keeping authorization and tenant isolation server-owned. Pair client/server documentation and lifecycle tests.
- [ ] E4.7 Allow resource-specific authorized database projections or business-service processing; validate computed/filter-sensitive changes and fall back to invalidation when mapping is insufficient.
- [ ] E4.8 Implement an online command round trip with operation identity, declared revision preconditions, validation, committed change publication and acknowledgement/event-echo correlation. Keep local drafts and optional later durable replay distinct.

Exit: adapters translate declared committed server changes into authorized client updates or invalidations under an explicit delivery/ordering contract.

## Other later extensions

React adapter, full RxJS adapter, pagination, global entity normalization, and SSR each require a separate task proposal. A1/A2 and E1–E4 track configuration, REST/transport/infrastructure integrations, stream ordering, offline recovery and the server companion. Preserve their boundaries now; none is implemented or a new prerequisite for R1 by default. Managed hosting is not assumed. Each later publication must add a useful tested capability while retaining the standalone client mode.

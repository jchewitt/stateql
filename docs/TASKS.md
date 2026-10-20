# StateQL task breakdown

Complete each chunk with its focused tests, independent agent review, and a passing `pnpm check`. Keep later package APIs internal until a concrete use case exercises them. The current delivery includes the repository foundation, Apollo comparison baseline, typed operation planner, and the first shared-store runtime chunk.

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

Exit: two consumers update correctly from a narrow request; reordering fixtures and switching accounts do not corrupt data. This establishes the comparison before StateQL is measured.

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
- [ ] P4.2 Implement DI, signal snapshots, reactive argument replacement, and destruction cleanup.
- [ ] P4.3 Add StateQL views beside the Apollo baseline with central and feature-derived definitions.
- [ ] P4.4 Demonstrate isolated form drafts, pristine-field refresh, dirty conflicts and explicit save with targeted invalidation. Apply the [forms contract](FORMS.md): immutable submitted payloads, edits during save, confirmed-save/failed-refresh distinction, reset to latest server data, scope/record isolation, unavailable records, and no automatic write retries.
- [ ] P4.5 Add browser tests for shared updates, narrow requests, account switching, errors, and cleanup; cover the P4.4 draft/save cases with the same policy for Apollo and StateQL.

Exit: the same fixture scenarios pass in both implementations and the adapter contains no second cache engine.

Form drafts remain editor-owned, separate from shared accepted server state and pending commands. Angular controls provide local storage; the proof of concept does not add another global cache or a forms framework. P4.1 exposes read-only observation, while P4.4 implements and validates the editing policy. Real socket commands and authoritative revision conflicts remain E1/E2/E4.

## P5 Compare and choose the next scope

Depends on P4.

- [ ] P5.1 Compare application declarations and coordination code separately from generated and dependency code.
- [ ] P5.2 Record actual payloads, operation counts, package cost, and planning overhead without relying on artificial network delay as a benchmark.
- [ ] P5.3 Document correctness boundaries and decide: continue independent runtime, narrow to a planner over an existing cache, or redesign.
- [ ] P5.4 Update the README with demonstrated behavior and a working demo guide.

Exit: a concrete evidence-backed decision, rather than an unsupported claim of superiority over Apollo.

## P6 Field polling

Depends on a continue decision in P5.

- [ ] P6.1 Add explicit interval units and owner-bound polling interests.
- [ ] P6.2 Share identical interests and avoid overlapping poll/retry chains.
- [ ] P6.3 Apply inherited global/domain/consumer policies and expose field-specific failure states.
- [ ] P6.4 Test fake-clock cadence, fastest-owner departure, retries, and final-owner disposal.

## R1 First experimental npm release

Depends on a useful implemented package, P5, and registry setup.

- [ ] R1.1 Confirm npm identity and ownership of the chosen package scope; update metadata if necessary.
- [ ] R1.2 Confirm the current npm flow for establishing new packages and trusted publishing; configure `jchewitt/stateql`, `publish.yml`, and environment `npm`.
- [ ] R1.3 Add the first prerelease Changeset, changelog, compatibility requirements, and actual usage examples.
- [ ] R1.4 Enable release readiness in a reviewed change; keep experimental versions on `next`.
- [ ] R1.5 Validate the tagged commit, packed artifacts, independent review, and hosted CI before dispatching the release workflow.
- [ ] R1.6 Verify registry metadata, provenance, and a clean installation from npm after publication.

No npm publish is part of F0. The scaffold does not reserve an npm name or configure an npm account.

## E1 Real-time stream cohesion

Planned product goal; depends on P3.8 and a continue decision in P5. Design alongside E2. See [the contract and acceptance criteria](../PLAN.md#e1-real-time-stream-cohesion).

- [ ] E1.0 Notify the user before streaming implementation and review the expanded server-driven invalidation/data-sync design together.
- [ ] E1.1 Define a validated, scoped event envelope and reusable routing from subscription/custom payloads to canonical resource/record/field addresses.
- [ ] E1.2 Feed pushes through the same ordering/commit/notification path as reads, without per-component cache reducers.
- [ ] E1.3 Define explicit list membership operations and safe invalidation when filter/path routing cannot be inferred.
- [ ] E1.4 Implement shared connection ownership, disposal, bounded reconnect, cursor resume/deduplication, and gap-triggered refresh.
- [ ] E1.5 Demonstrate a real GraphQL subscription plus a fake custom event source; test duplicate/malformed events, scope isolation, and HTTP/push overlap.
- [ ] E1.6 Compare application code against Apollo automatic normalized updates and explicit list updates, including required adapter mappings on both sides.
- [ ] E1.7 Add configurable invalidation-only and data-update modes over WebSocket/SSE; keep client-only invalidation/fetch behavior available without a server companion.
- [ ] E1.8 Define bounded retention of invalidation tokens for inactive resources, on-demand reacquisition, revision handshakes/replay, and gap-triggered validation.

Exit: ordinary field pushes update all interested consumers through one declared binding; list and reconnect semantics are explicit and tested.

## E2 Revision-aware ordering across transports

Planned product goal; depends on P3.6 and a continue decision in P5. Define the contract alongside E1; integrate its transport fixtures when available. See [ordering guarantees and limits](../PLAN.md#e2-revision-aware-ordering-across-transports).

- [ ] E2.1 Define comparable authoritative revisions, comparison domains, epochs, and explicit timestamp/unversioned-source policies.
- [ ] E2.2 Track covered field/subtree and membership revisions separately; distinguish local request generations from server revisions.
- [ ] E2.3 Reject stale overlapping updates while allowing needed independent fields; handle equal-version conflicts, structural nulls, identity replacement, and deletion tombstones.
- [ ] E2.4 Distinguish replacement snapshots from dependent deltas; implement deduplication, bounded gap handling, and authoritative resynchronization.
- [ ] E2.5 Exercise HTTP/poll/push/command-ack reordering, duplicates, missing predecessors, clock ties/skew, epoch changes, and missing revision metadata with deterministic sources.
- [ ] E2.6 Expose drop/conflict/resync diagnostics and document the conditional consistency guarantee.

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

Planned extension requested October 20, 2026; design with E1/E2 after the user discussion. See [server contracts and acceptance criteria](../PLAN.md#e4-adapter-based-server-event-companion).

- [ ] E4.1 Define separate event-input, routing/projection, and delivery interfaces; keep server/database dependencies outside portable core.
- [ ] E4.2 Implement business-event input and a deterministic database-change-feed example, publishing committed changes with event IDs and revision coverage.
- [ ] E4.3 Route scoped invalidation tokens or data updates through WebSocket/SSE delivery, with server authorization and safe fallback for computed fields/filtered lists.
- [ ] E4.4 Define durable publication options, replay, backpressure, gaps, and resynchronization without promising atomic database/event delivery from ordinary callbacks.
- [ ] E4.5 Demonstrate both modes end to end, including inactive pages, deletes, duplicate/out-of-order events, reconnect, scope changes, and client-only fallback.

Exit: adapters translate declared committed server changes into authorized client updates or invalidations under an explicit delivery/ordering contract.

## Other later extensions

React adapter, full RxJS adapter, production REST source, pagination, global entity normalization, and SSR each require a separate task proposal after the core experiment. E1–E4 track stream, ordering, offline, and server event-companion goals explicitly. Preserve their execution/commit boundaries now; none of these roadmap items is implemented or a new prerequisite for R1 by default.

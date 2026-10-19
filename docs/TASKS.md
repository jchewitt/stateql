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
- [x] P3.3 Implement field/branch invalidation and requested/fetched/committed coverage. See [invalidation semantics](ACQUISITION.md#selective-invalidation-and-refresh); reads remain serialized pending P3.6.
- [ ] P3.4 Implement identity-based list patching separately from membership replacement.
- [ ] P3.5 Handle omitted fields, successful nulls, structural nulls, and GraphQL partial errors.
- [ ] P3.6 Implement in-flight deduplication, field generations, cancellation ownership, and late-response protection.
- [ ] P3.7 Add bounded read retries and field error state; keep writes outside automatic retries.
- [ ] P3.8 Demonstrate a vanilla TypeScript consumer plus fake whole-resource and push-event adapters.

Exit: the relevant acceptance matrix in `PLAN.md` passes, including invalidation during an existing fetch and response reordering.

## P4 Angular integration and forms

Depends on P3.

- [ ] P4.1 Add the actual Angular library, appropriate peer dependencies, and Angular Package Format build/pack checks.
- [ ] P4.2 Implement DI, signal snapshots, reactive argument replacement, and destruction cleanup.
- [ ] P4.3 Add StateQL views beside the Apollo baseline with central and feature-derived definitions.
- [ ] P4.4 Demonstrate a dirty form draft, pristine-field refresh, save mutation, and targeted invalidation.
- [ ] P4.5 Add browser tests for shared updates, narrow requests, account switching, errors, and cleanup.

Exit: the same fixture scenarios pass in both implementations and the adapter contains no second cache engine.

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

## Later extensions

React adapter, full RxJS adapter, REST source, WebSocket/event protocol, Node event-publishing companion, pagination, global entity normalization, SSR, and offline behavior each require a separate task proposal after the core experiment. Preserve their execution/commit boundaries now without implementing speculative infrastructure.

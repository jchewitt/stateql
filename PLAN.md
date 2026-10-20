# StateQL Architecture and Proof of Concept Plan

Approved implementation direction · October 16, 2026

Implementation is tracked in [docs/TASKS.md](docs/TASKS.md). The repository-foundation milestone is being established first; proposed runtime API examples below remain design examples until their tasks are complete.

StateQL will use composable data definitions to derive requests, address shared cached state, and target refreshes. Its first proof of concept will combine a framework-independent TypeScript runtime, a GraphQL source adapter, an Angular integration, and a small billing application. An equivalent Apollo implementation will establish whether StateQL materially reduces application wiring while preserving correct behavior.

Angular is the confirmed first UI. Plain TypeScript usage is part of the proof of concept. React, REST, WebSockets, and a possible Node server companion are later extensions; their requirements shape the boundaries now.

## Product hypothesis and evaluation

The central workflow is:

```ts
const invoices = client.watch(billing.invoices, variables);
await invoices.invalidate('accountId');
```

StateQL retains the existing scoped invoice state, generates a request for accountId plus required context and identity fields, merges the successful response into that state, and updates affected consumers. Other values and their freshness remain unchanged. A consumer can derive a subset or extension of a central definition without introducing a new, independently managed cache key.

The proposed advantage is a unified workflow for selection, identity, and refresh. Caching, reactivity, retries, and GraphQL generation are supporting mechanisms. The project succeeds if ordinary application code no longer has to coordinate separate definitions for fetching a field, locating its cached value, and keeping consumers synchronized.

Apollo can merge fields from separate operations into the same normalized object and notify watchers. Its documented field invalidation workflow identifies queries to refetch. The comparison must include a narrow Apollo query that achieves the same network result, not just a full-query refetch. [Apollo caching](https://www.apollographql.com/docs/react/caching/overview), [Apollo refetching](https://www.apollographql.com/docs/react/data/refetching)

Relay generates refetch queries for declared fragments, and Genql generates GraphQL from JavaScript selections. These are relevant precedents. StateQL's candidate distinction is runtime composition and field refresh through a stable state definition with fewer application-owned declarations. No ecosystem-wide uniqueness claim is assumed. [Relay refetchable fragments](https://relay.dev/docs/tutorial/refetchable-fragments/), [Genql](https://genql.dev/docs)

The product roadmap also targets three related problems: repeated application code for stream-to-cache updates, stale updates arriving across different transports, and framework-independent offline recovery. These are planned capabilities, not implemented guarantees. Their contracts and evaluation criteria appear in [Stream cohesion, ordering, and offline recovery](#stream-cohesion-ordering-and-offline-recovery). Prefer proving stream cohesion and ordering together before expanding into durable write replay.

## Scope of the first proof of concept

| Included                                                                | Deferred                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| Central definitions, nested selections, reusable subsets and extensions | Arbitrary client-defined joins across endpoints            |
| Direct GraphQL name matching and one explicit alias example             | General data transformation and computed-field framework   |
| Argument-scoped shared state and typed field references                 | Global entity sharing across unrelated query paths         |
| Field and branch invalidation with generated narrow requests            | Complete GraphQL feature coverage                          |
| Identical-request deduplication, race protection, field freshness       | Aggressive batching of overlapping operations              |
| Basic read retry policy and field-specific errors                       | Optimistic mutation engine and offline queues              |
| Angular signals integration and vanilla TypeScript example              | React adapter and full RxJS integration package            |
| One save interaction followed by targeted invalidation                  | Automatic inference of mutation side effects               |
| Apollo baseline and request inspector                                   | Production developer-tools extension                       |
| Deterministic tests for lifecycle and reconciliation                    | Production REST, socket, SSR, or server companion packages |

Field polling is a small follow-on milestone after the core comparison. It is not required to prove the first selective-refresh workflow.

## Architecture boundaries

StateQL is GraphQL-first in its public API and default setup. The default client bundles the GraphQL source and HTTP transport; application developers do not assemble adapters for ordinary GraphQL usage. Definitions deliberately follow GraphQL field, argument, and selection semantics.

One authoritative, schema-resolved selection structure drives both cache addressing and GraphQL generation. Invalidation selects nodes from that same structure. There is no separately maintained generic query language or key-to-GraphQL mapping model. Optional naming aliases resolve once into canonical field references used by both consumers of the structure.

The internal boundary sits where the planned selection becomes an executable backend operation, with a corresponding boundary for decoding results. The core can understand paths, fields, identities, and selections while leaving GraphQL document construction and protocol-specific response interpretation in the GraphQL module. This preserves the direct definition-to-query flow.

```text
Angular adapter       Plain TypeScript       React adapter later
       \                    |                    /
        Shared handles, snapshots, and subscriptions
                            |
                    StateQL core runtime
     definitions / cache / freshness / planning / scheduling
                            |
                      Source adapter
          GraphQL initially; REST and event sources later
                            |
                Protocol-specific request or event
                            |
                       Transport
                HTTP initially; sockets later

Response or push event -> adapter decoding -> validated cache changes
                     -> core commit -> affected consumers
```

The core asks what fields need updating. The source adapter determines what operations the backend can support. The transport sends those operations. Framework adapters expose shared state using their framework's lifecycle and reactivity.

| Boundary        | Owns                                                                                                                              | Must not own                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Core            | Immutable definitions, canonical field addresses, cache records, freshness, request coordination, subscriber projections, commits | GraphQL ASTs, HTTP clients, Angular, React, RxJS, DOM globals |
| GraphQL source  | Schema metadata, path and argument resolution, operation construction, identity selections, response/error-path decoding          | UI signals, component lifetimes, an independent cache         |
| Transport       | Request execution, headers, cancellation, connection concerns                                                                     | Cache identity, field selection semantics, form state         |
| Angular adapter | DI, signals, reactive argument changes, automatic disposal                                                                        | Its own fetch or retry engine                                 |
| Server demo     | Billing schema, fixtures, deterministic delays/errors and mutations                                                               | StateQL-specific requirements on an ordinary GraphQL server   |

Keep these as module boundaries even where they share a package. Avoid publishing a package for every interface before a second implementation demonstrates the need. Keep the source interface internal and provisional during the proof of concept. Do not weaken GraphQL's supported semantics to accommodate hypothetical REST limitations or build a public plugin framework before a real second source requires it.

### Minimal contracts

The core exposes getSnapshot(), subscribe(listener), and dispose() on active handles. Snapshots are immutable, preserve their reference until relevant state changes, and contain data completeness, fetching state, and errors. Reading a snapshot has no network side effects. subscribe returns an unsubscribe function; dispose releases the handle's ownership and scheduled work.

A source adapter resolves a definition into canonical addresses, prepares an operation from a refresh intent, and decodes its result into cache changes. A prepared operation includes its request fingerprint, fetched-field coverage, commit-field coverage, and reconciliation metadata. The transport receives the prepared request and an AbortSignal; the core never needs to understand its wire representation.

Decoded changes distinguish field writes, structural nulls, membership replacements, deletions, and field failures. The core applies them through one commit path with scope and concurrency checks. A future event source uses that same path.

Adapter capabilities describe supported operations: selectable fields versus whole-resource reads, identity availability, and optional event/version support. Implement only the distinctions exercised by the GraphQL source and contract tests initially. Unsupported operations fail clearly; adapters must not silently change a narrow update into a destructive full replacement.

Only implement the GraphQL adapter and a deterministic fake adapter initially. Use the fake to demonstrate that the core can process a whole-resource response and a pushed patch without GraphQL-specific code. This tests the boundaries without building REST or WebSocket products prematurely.

## Definition composition and developer API

All layers use one immutable definition model. A definition describes a path, arguments, selections, source binding, and inherited policies. Binding it to argument values produces access to scoped state. Consumer selections project that state; they do not own separate copies.

| Layer                | Role                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| Client configuration | Source registration, transport, default freshness/retry policy, cache scope |
| Domain definition    | Shared paths, selections, mappings, identity conventions                    |
| Feature definition   | Reusable subset or extension for a workflow                                 |
| Consumer definition  | Local selection within the shared domain                                    |
| Operation selection  | Temporary target for invalidation or refresh                                |

Provisional API example; the first milestone will validate names and TypeScript inference before freezing syntax:

```ts
// schema is generated from the demo GraphQL schema.
const invoiceBase = schema.query.billing.invoices.pipe(
  select({ id: true, accountId: true, amount: true }),
);

const billing = { invoices: invoiceBase };

const paymentInvoices = billing.invoices.pipe(
  select({ id: true, accountId: true }),
  extend({ status: true }),
);

// Arguments are attached to the relevant path node, including ancestors.
const variables = {
  billing: { accountId: 'B1' },
  invoices: { status: 'OPEN' },
};

const handle = client.watch(paymentInvoices, variables);
const unsubscribe = handle.subscribe(() => render(handle.getSnapshot()));

await handle.invalidate('accountId');
await handle.invalidate(); // Refresh this handle's declared selection.

unsubscribe();
handle.dispose();
```

Typed field references are preferred for nested paths and reusable policies. A string shorthand such as accountId is type-checked against the definition. The familiar array path ['billing', 'invoices'] may be supported as a typed lookup into registered definitions, not as an unrelated second cache-key scheme.

Composition rules:

- select narrows a consumer view; extend unions compatible selections. Neither mutates the parent.
- A refresh selection is temporary and never edits the default query definition.
- Repeated identical selections are idempotent. Conflicting mappings or argument definitions produce errors rather than depending on merge order.
- Policy precedence is client, domain, feature, then consumer or operation. Only explicitly provided policy values override inherited values.
- Identity and source mappings cannot be silently overridden at a local form. A distinct binding is required if their semantics change.
- Direct field names map to GraphQL by default. An explicit alias changes the application-facing name while retaining the canonical source field address. The proof of concept includes one alias to test this.
- Extensions are validated against schema metadata. A consumer cannot invent a field merely because it exists in an untyped object.

Central registration is the default application convention. Strict enforcement of allowed extensions is deferred until real usage establishes which restrictions help.

### Type safety and setup

Proposed setup is one client provider, endpoint configuration, and one development-time schema-generation command. The generated output supplies selection/argument types and compact runtime metadata for operation generation. Avoid requiring handwritten copies of server interfaces or a separate key-to-query mapping.

Schema generation is a proposed implementation choice, not a previously confirmed user requirement. Prove its ergonomics in the API milestone. A schema-less mode could be added later with explicitly weaker type guarantees. Do not promise that arbitrary GraphQL arguments, enum values, and variable types can be inferred from field names alone.

Generate valid operations using GraphQL tooling first. Values travel as variables. Validate generated documents against the demo schema in tests. Optimize serialization only if measurement shows it matters. Known unsupported features, including abstract types and advanced directives in the first prototype, must be rejected before transport. [GraphQL queries](https://graphql.org/learn/queries/)

## Identity and cache rules

Three identities have different jobs:

1. State address: source/client scope, canonical resource path, and all relevant ancestor and local arguments.
2. Field address: state address plus nested canonical field path, field arguments, and record identity where needed.
3. Request fingerprint: the generated operation and variables used for in-flight deduplication.

A narrower request changes the third identity without changing the existing state or field addresses. No developer-managed refresh key is required. Canonical serialization preserves nesting and value types, sorts object properties, and preserves list order. It distinguishes omitted inputs from explicit null where backend semantics require it.

Aliases resolve to their canonical fields. Client/account scope is explicit; logout or scope replacement disposes the old cache context and rejects its late responses. Credentials are not embedded in visible cache keys.

The initial store shares data among definitions resolving to the same canonical path and arguments. For lists, records are keyed within that scoped resource. The prototype does not automatically unify an invoice reached through a different root query. Global entity normalization would be a separate decision; the first README must explain this boundary.

### Field invalidation

invalidate(selection) marks the addressed fields stale and, by default, refreshes them when the handle is active. A watch handle is active from creation until disposal, even before a UI listener is attached. Existing values remain readable during refresh. An explicit refetch: 'none' option only marks stale; a refresh(selection) convenience can request immediately without first changing displayed freshness.

The returned promise settles after the requested refresh, rejecting on failure while retaining error state for subscribers. Mark-only invalidation resolves immediately. No-argument invalidation targets the handle's declared selection; broad domain invalidation across multiple argument sets is a later explicit API, never an accidental consequence of matching a string prefix.

After a successful response, only committed fields become fresh. Subscribers receive updates when their projected values or relevant loading/error/freshness metadata change. Adding fields to shared storage does not widen another consumer's declared result type.

A view may therefore contain fields observed at different times. Related fields that must be consistent should be refreshed as a group; StateQL does not promise a transactional server snapshot from separate reads.

### Merge and failure behavior

An omitted field means no update. A successful explicit null means null. GraphQL errors can accompany partial data; response paths and schema nullability determine which fields failed or whether a structural null invalidates descendants. Do not treat an error-induced null as an ordinary successful refresh or retain children under a parent that has become null. [GraphQL response semantics](https://graphql.org/learn/response/)

Use field generations and request sequence numbers to prevent an earlier request from overwriting a newer write or clearing a later invalidation. An invalidation arriving during an older fetch remains pending until a sufficiently new request resolves. Structural changes also advance the affected subtree's generation. Local ordering prevents client races; it cannot establish cross-client server ordering without server revisions.

Deduplicate identical in-flight reads. Abort work when it has no owners, while preserving a shared request if another consumer still needs it. Include a configurable retention period for inactive cached state and explicit client disposal. These rules must work with injected clocks and fake transports.

### Collections and relationships

Selective list refreshes include record identity, such as id and typename when required by the identity policy. Never merge by array position. Identity conventions come from schema metadata or explicit configuration; GraphQL alone does not guarantee a usable identifier.

Refreshing an invoice field patches matching existing records and preserves list membership and ordering. Unknown returned records are not inserted as incomplete invoices. Missing records are not assumed deleted. Both cases flag membership as potentially stale for an explicit list refresh. A list refresh replaces membership/order and fetches the fields needed for its requested view.

A filtered list can stop returning an invoice precisely because the invalidated status changed. Without a server lookup for that invoice, a narrow list request cannot recover its new status. Keep that record's targeted field stale and report the refresh as incomplete rather than claiming success. The caller can request a list refresh; a future adapter can use an available item lookup without changing this contract.

If reliable item identity is unavailable, reject partial list merging with a useful explanation; permit an explicit whole-list refresh. Do not quietly discard unrelated cached fields. Nested objects with their own identity use that identity; unkeyed embedded objects follow their parent path and structural replacement rules.

Relationships initially follow server schema paths. Client-defined joins, pagination merging, and dependency inference are deferred. A domain may later declare related fields that should refresh together, since business dependencies cannot be inferred from GraphQL shape alone.

## Framework and transport expansion

### Angular first

Provide the shared client through DI. injectStateQuery binds a definition and reactive arguments, exposes data and status signals, and releases its handle on destruction. When arguments change, detach from the old address and attach to the new one; late old responses must not appear under the new selection.

The core subscription API is sufficient for both signals and Observables. Start with signals and demonstrate Angular's existing RxJS interop rather than implementing two state engines. A later RxJS adapter can wrap core subscriptions directly. [Angular interop](https://angular.dev/ecosystem/rxjs-interop)

The demo uses a read-only summary and an editable form. Form values are drafts. Bind fresh server values into pristine controls; preserve dirty controls and expose a conflict indication if their server baseline changes. Use a small explicit demo binding, not a new form framework. Saving performs one mutation, then targeted invalidation after success. Writes are not automatically retried.

### Plain JavaScript and React

The vanilla example uses the same client and subscribe/getSnapshot contract with explicit disposal. The library can be consumed by JavaScript even though implemented in TypeScript; the first smoke example is TypeScript.

A later React adapter can use useSyncExternalStore with stable snapshots and subscription cleanup. This is why immutable snapshot identity and side-effect-free reads belong in the core contract now. SSR snapshots and hydration remain a later feature. [React external stores](https://react.dev/reference/react/useSyncExternalStore)

### REST

A REST source declares endpoint resolution and response field mappings where necessary. GraphQL's direct-name default remains convenient without pretending that an arbitrary REST URL can be derived from every state path.

The future REST source consumes the planned structured selection before GraphQL document generation. It need not generate a GraphQL string and parse it back into REST calls. Any endpoint mappings belong to that source, leaving the default GraphQL flow direct.

Distinguish requested fields, fetched fields, and committed fields. A whole-resource endpoint can return an entire invoice while StateQL commits only the requested accountId update, preserving the selective-update contract. A configurable whole-resource commit policy may later accept all returned fields; it must also update their freshness and notify their consumers honestly.

Structural nulls, deletion responses, and incompatible identity changes require structural handling even during a narrow request. They cannot safely be hidden by a field mask. The adapter reports those conditions to the core. REST support offers selective state updates; network payload savings depend on server support for sparse fields or equivalent filtering.

### WebSockets and a Node companion

WebSocket is a transport, not a cache model. GraphQL subscriptions and a custom REST-plus-events protocol can both feed decoded changes into the core's commit path. Keep the event source separate from ordinary request execution so one connection can serve multiple field interests.

Future event envelopes need scoped resource/record identity, change kind, affected fields, and revision or sequence metadata where available. Support explicit patch and invalidate events; invalidation can trigger a normal read when an event carries no data. Reconnect must detect gaps or conservatively mark affected state stale and fetch a new baseline. Deduplicate replayed events, define deletion and list-membership events, and bound queued work.

The core can run in Node without an Angular or browser dependency. A server companion would be a separate package for publishing events and sharing generated definitions; it is not required for the GraphQL prototype. Server authorization remains server-owned. SSR use must create an isolated client per request/session rather than share a global cache between users. Persistent server caching and distributed coherence need their own later design.

## Stream cohesion, ordering, and offline recovery

Added to the product roadmap October 19, 2026. The first proof of concept and P5 comparison remain the immediate delivery sequence. Preserve the necessary boundaries during P3.6/P3.8; full implementations are tracked as E1–E3 in [the task list](docs/TASKS.md). These goals should reduce application-owned coordination, with explicit limits on what the client can infer.

### E1 Real-time stream cohesion

Problem: HTTP reads, subscription messages, and custom events often require separate application logic to locate shared state, merge updates, and keep views synchronized. The desired workflow is one reusable source binding into the same validation, ordering, commit, and notification path used by reads.

Apollo already supports subscriptions and caching. Its `subscribeToMore` documentation includes `updateQuery` for incorporating newly added list items; that does not mean every update to an existing normalized entity requires a reducer. Compare StateQL against ordinary normalized entity updates as well as list insertion/removal and custom event envelopes. [Apollo subscriptions](https://www.apollographql.com/docs/react/data/subscriptions), [Apollo normalization](https://www.apollographql.com/docs/react/caching/overview)

StateQL should decode and validate a declared event envelope into scoped canonical addresses, record identities, affected fields, and an explicit change kind. The adapter owns protocol parsing and any reusable envelope mapping. Core applies those changes and notifies interested consumers; UI components should not rewrite cached query trees. Stable addresses do not identify the meaning of arbitrary payloads automatically. With path-scoped storage, an entity-only event also needs a declared routing/invalidation policy for affected resource paths and argument sets; global entity fan-out is not implied.

Acceptance: an HTTP-loaded view and two consumers receive a field push with no component-level reducer; unrelated fields remain unchanged. List membership uses explicit insert/remove/replacement semantics or invalidation when filters cannot be evaluated safely. Duplicate events, reconnect gaps, malformed envelopes, source errors, scope changes, and final-owner cleanup are tested. A bounded reconnect policy resumes from a cursor or refreshes a baseline. No network operation or persisted event may cross an authorization scope. Use one real GraphQL subscription example and one fake custom event source before claiming transport independence.

### E2 Revision-aware ordering across transports

Problem: HTTP responses, poll results, stream messages, and mutation acknowledgements can arrive in a different order from the server changes they represent. Local request generations protect client work, but cannot establish server causality across independent channels.

Use an adapter contract for authoritative revisions or sequence numbers with a declared comparison domain and server epoch. These are data revisions, not package semantic versions. HTTP snapshots and stream messages must provide comparable revisions for an ordering guarantee across transports. Wall-clock timestamps are an optional policy with documented clock-skew and tie limits, never the default basis for an absolute-consistency claim. Opaque equality tokens can support conditional writes without necessarily supporting ordering.

Track revision coverage at the affected field/subtree and list-membership level. A newer update to field B must not cause an older-but-still-needed update to field A to be discarded merely because the record has a higher watermark. Parent nulls, identity replacement, deletion tombstones, and membership replacement need structural revision rules to prevent stale resurrection. Related fields requiring an atomic server snapshot must declare a group; independent field freshness does not imply transaction consistency.

Distinguish absolute replacement values from dependent deltas. A replacement snapshot may supersede older values; an increment or patch requiring revision N cannot skip missing revisions safely. Use base revisions, bounded buffering, deduplication, and gap-triggered resynchronization. Equal revisions with different contents and incomparable epochs are protocol conflicts to report, not arbitrary last-arrival winners. Define explicit behavior for unversioned sources; do not let an unversioned response silently overwrite revision-protected state.

Acceptance: revision 12 arriving before revision 11 cannot be rolled back on overlapping fields, regardless of transport. Duplicate events are idempotent; independent fields can recover; missing delta predecessors trigger resynchronization; stale snapshots cannot resurrect deleted records. Reconnect and server-epoch changes require an authoritative baseline. Drops and conflicts expose diagnostics without spurious UI updates. The guarantee is no regression within the declared revision contract, not absolute distributed consistency. Server-side conditional writes remain necessary for write conflicts; version-based optimistic concurrency is an established pattern. [AWS concurrent-update guidance](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/BestPractices_ImplementingVersionControl.html)

### E3 Framework-independent persistence and offline recovery

Problem: applications repeatedly build storage, restore, reconnect, and pending-write logic around their state library. The goal is a reusable persistence/recovery layer with the same scoped state model across Angular, plain JavaScript, and later React.

Separate cached-data persistence from a durable outgoing command queue. Apollo already documents cache persistence and rehydration through `apollo3-cache-persist`; compare equivalent capabilities instead of presenting persistence itself as new. [Apollo persistence](https://www.apollographql.com/docs/react/caching/advanced-topics#persisting-the-cache)

Composition methods or pipe syntax do not automatically form a serializable transition journal. Define explicit versioned data records for checkpoints, confirmed changes, and pending commands. Never serialize closures, subscriptions, framework objects, or transports. An asynchronous storage adapter keeps IndexedDB and browser APIs outside core. If a localStorage adapter is offered, give it an explicit size/serialization limit rather than assuming equivalent transactional capabilities.

First persist selected cached data with scope, schema/codec version, field presence/null distinctions, freshness, revisions, and membership metadata. Restore atomically, validate/migrate older schemas, handle quota/corruption/storage failures, and coordinate hydration with incoming reads/events so an old checkpoint cannot overwrite live state. Apply an explicit revalidation policy on reconnect. Persistence is opt-in by data policy; isolate users/tenants and clear or segregate persisted state and pending work when authorization changes.

Then add a separate opt-in outbox for commands explicitly declared replayable. Record operation ID, scoped target, payload, base revision/preconditions, dependencies, and delivery/acknowledgement state. Keep optimistic drafts distinct from confirmed server state. Safe retries after ambiguous acknowledgements need server-supported idempotency within its documented retention contract; client replay alone cannot promise exactly-once effects. Conflicts, expired credentials, unsupported schema changes, and expired idempotency windows require reconciliation or an explicit blocked state. Keep business-specific resolution pluggable. [Stripe idempotent-request contract](https://docs.stripe.com/api/idempotent_requests)

Acceptance: identical checkpoints restore correctly into plain TypeScript and Angular consumers; framework hydration stays adapter-owned. A crash between command delivery and acknowledgement cannot silently duplicate the server effect when replay uses the agreed idempotency contract. Duplicate stream echoes are reconciled, old checkpoints cannot overwrite newer events, user switching cannot replay another user's commands, and multi-tab ownership prevents competing replay workers. Document recovery limitations and preserve pending work when recovery fails.

### Product evaluation and priority

E1 and E2 together are the strongest near-term expansion hypothesis for applications combining live streams and requests. Measure application declarations/handlers, list-policy code, reconnect behavior, dropped stale updates, and correctness under reordered delivery against an equivalent Apollo setup. E3 could broaden appeal for PWAs and intermittently connected applications, but carries a larger storage and mutation-consistency scope; deliver persistence before durable writes. These capabilities are not individually unique. Desirability depends on demonstrably reducing coordination code while preserving predictable behavior, supported by working examples and failure tests. None is required to publish the first experimental release unless a later release decision explicitly adds it.

## Polling and retry policies

After the first comparison succeeds, add field polling through the same planner and commit path:

```ts
const stop = invoices.field('status').poll({ everyMs: 10_000 });
// stop() or handle disposal releases this owner's polling interest.
```

Use explicit milliseconds. Group identical state-and-field polling interests; the fastest active requested cadence wins, returning to a slower cadence when the faster owner leaves. Keep distinct field groups separate initially rather than fetching all fields at the fastest interval. Do not overlap a poll with an equivalent pending read or create a queue of missed ticks. Stop when the last owner releases the interest. Optional browser visibility policy belongs outside the portable core.

Proposed read defaults are two retries after the first attempt, exponential backoff with jitter, and a bounded timeout. Retry transient transport failures and configured retryable responses; do not automatically retry schema/validation errors, authorization failures, cancellations, or ordinary business errors. Global defaults are inherited and overridable. No automatic write retries without an explicit idempotency contract.

Polling and retry timers share a scheduler so a poll does not spawn another retry chain while its previous read is recovering. Field errors coexist with unaffected data. Advanced partial-error retry and combining unequal polling schedules are later optimizations.

## Workspace and implementation sequence

Create a simple TypeScript workspace when implementation begins. Pin mutually compatible tool and framework versions then. Use a small Node GraphQL fixture server with in-memory data; the library does not depend on its server framework. StateQL is a working name; package and repository availability are checked before publication.

```text
stateql/
  packages/
    core/                 definitions, handles, cache, planner, scheduler
    graphql/              schema support, compiler, decoder, HTTP transport
    angular/              DI and signal integration
  apps/
    billing-api/          deterministic GraphQL fixture server
    billing-demo/         StateQL and Apollo views of the same scenario
  examples/
    vanilla/              core plus GraphQL without Angular
  tests/
    contracts/            fake source, whole-resource and event ingress checks
    scenarios/            shared acceptance scenarios and browser checks
  docs/
    architecture.md
    api.md
    comparison.md
    decisions.md
```

The structure above describes the target workspace. The initial foundation makes core buildable and reserves the later module boundaries. The task list distinguishes completed scaffolding from the remaining runtime and demo implementation.

| Milestone                         | Work                                                                                                                                  | Completion evidence                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 0. Settle the contract            | Review definition examples, identity rules, supported schema subset, schema generation, invalidation defaults, and benchmark workload | Small API examples and executable acceptance specifications ready to implement               |
| 1. Establish Apollo baseline      | Fixture server, central GraphQL fragments, two consumers, narrow refresh query, one save, errors and inspector                        | Same narrow network behavior and shared updates demonstrated using idiomatic Apollo          |
| 2. Build vertical StateQL slice   | Core plus GraphQL adapter; central definition, subset/extension, scalar and nested invalidation, list identity, vanilla consumer      | Valid generated documents; same scoped cache enriched and updated; race and merge tests pass |
| 3. Integrate Angular              | Signal adapter, reactive arguments, cleanup, demo form and second consumer                                                            | Browser acceptance scenarios pass and no duplicate state engine exists in the adapter        |
| 4. Evaluate the hypothesis        | Compare declarations, coordination code, payloads, request counts, and correctness; test fake alternate source/event ingress          | Written continue, narrow, or stop decision with measurements and tradeoffs                   |
| 5. Add field polling if warranted | Shared polling interests and global/local retry policies                                                                              | Fake-clock tests prove deduplication, teardown, and retry/poll coordination                  |

Milestones 0 through 4 form the initial proof of concept. Future adapters are scheduled only after its result is assessed.

## Acceptance scenarios

| Scenario                                                | Required result                                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Two identical consumers mount together                  | One initial read; both observe shared state                                               |
| Feature extends a base definition                       | Parent remains unchanged; compatible fields share underlying storage                      |
| Second consumer needs one additional field              | Existing fresh fields are reused; only missing fields plus identity/context are requested |
| Invalidate accountId                                    | Narrow generated operation; accountId changes, other values/freshness remain unchanged    |
| Invalidate nested user.name                             | Ancestor path and arguments retained; sibling fields preserved                            |
| Invalidate a branch                                     | Defined fields beneath the target refresh; unrelated branches remain untouched            |
| Same field name exists under another path               | No accidental invalidation through substring matching                                     |
| Arguments or client scope differ                        | Separate state; no cross-account values                                                   |
| Alias addresses accountId by another name               | One canonical field and correct response projection                                       |
| Invoices return in a different order                    | Fields merge by identity without reordering the existing list                             |
| New or missing list member appears during field refresh | No partial insertion or inferred deletion; membership flagged stale                       |
| Explicit null, missing field, and partial GraphQL error | Distinct outcomes; no false success or stale descendants under null parents               |
| Older full response arrives after a newer field refresh | Older data cannot overwrite the newer field                                               |
| Invalidation arrives during an earlier fetch            | Earlier completion cannot clear the newer invalidation                                    |
| Refresh fails and later succeeds                        | Last data remains usable; field error clears only after appropriate success               |
| One owner disposes during shared work                   | Other consumer's request survives; final disposal releases work                           |
| Angular arguments switch while loading                  | New view never displays a late response from the old arguments                            |
| Dirty form receives refreshed server data               | Draft is preserved; changed server baseline is visible                                    |
| Fake source returns a full payload for a narrow intent  | Commit coverage preserves unrelated fields                                                |
| Fake event source delivers a patch                      | Same core commit and notification path used without GraphQL dependencies                  |

Use focused unit tests for canonicalization, selection composition, valid operation generation, merge behavior, and scheduling. Use deterministic transport controls for races and fake clocks for retention/retry/polling. Run a small browser suite for user-visible sharing, refresh, form behavior, and cleanup. Type tests must catch invalid fields/arguments and preserve inferred subset types. Prefer these behavioral tests over implementation-mirroring tests.

## Comparison and decision criteria

Use identical fixture data, server delay, failure cases, and consumer requirements. Apollo receives sensible normalization policies and reusable fragments. Include both its standard broad refetch and the narrow-query version that meets StateQL's payload goal. Keep dependency code, generated code, application declarations, and coordination glue separately accounted for.

Measure network operations and selected fields, payload bytes, application-owned query/mapping definitions, manual merge/update orchestration, and the steps required to add a new refreshable field. Report generation/planning time and browser bundle cost separately; do not claim performance superiority from a contrived loop benchmark or mock delay. Compare serializable outputs for the shared scenarios and explain any differences in scope.

Continue if StateQL removes repeated narrow-query/key/update wiring, maintains typed composition, and passes the correctness scenarios without routine per-form special cases. A change to one refresh target should not require editing a separate GraphQL document, cache key, and mapping function.

Narrow the project to a compiler/planner layer over an existing cache if that delivers most of the benefit with less maintenance. Stop or redesign if ordinary Apollo helpers provide comparably simple behavior, or if StateQL's configuration merely relocates the same complexity. A smaller public API is valuable only when its behavior is also predictable.

## Decisions before implementation

Confirmed direction: Angular first, framework-independent core, GraphQL first, shared stable state with selective invalidation, centralized definitions with reusable overrides, and an Apollo comparison. Git and remote repository creation follow planning.

Proposed defaults for review: schema generation for strong typing; path-and-argument-scoped sharing rather than global normalization; identity-required selective list updates; active-handle refetch on invalidation; field polling after the initial comparison; small explicit form binding instead of a form package.

The next working session should walk through one definition from domain configuration to feature subset to form selection to generated accountId refresh. Settle any changes to those defaults, then begin Milestone 1 with the Apollo baseline and shared fixture server.

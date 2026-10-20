# Billing comparison demo

The app includes the completed P1 Apollo baseline and P4.3 StateQL views against the same ordinary GraphQL schema. The API and demo are private workspace applications, not published npm libraries. Forms integration and the complete parity matrix remain P4.4/P4.5.

## Start and inspect

Use Node 24 and pnpm 10.18.2. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm demo
```

Open http://127.0.0.1:4200 for Apollo or http://127.0.0.1:4200/?client=stateql for StateQL. Navigation links reload the application with a fresh client cache; server fixtures and the request log persist until reset. The dev command builds the workspace libraries before starting Angular, including on a clean checkout. The Angular dev server proxies GraphQL and fixture-control requests to http://127.0.0.1:4100. Stop both with Ctrl+C. These ports must be available; browser tests also use them and start their own servers.

1. Both panels independently call Apollo Angular `watchQuery` with the same reusable document. One initial HTTP request feeds both subscriptions.
2. **Change server data** advances account IDs, amounts, and user names in the current tenant. It leaves Apollo's cache alone.
3. **Refresh account IDs** sends `InvoiceAccounts`, selecting account IDs and required identity/context fields. Both consumers update; amounts and names retain their previous values.
4. **Refetch full query** refetches active `BillingInvoices` watchers. Amounts and names catch up.
5. Expand inspector rows to see the actual GraphQL document, variables, unique field names, error messages, and UTF-8 response-body byte count. Count includes accepted GraphQL operations, including in-flight operations; rows show the last 100 completed operations in completion order. Fixture controls and inspection requests are excluded. This is network evidence, not a performance benchmark.

## Apollo scenarios

| Control                 | Observable behavior                                                                                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant A / B            | Both tenants reuse invoice/user IDs. Cache keys include immutable `tenantId` plus `id`; the mutable `accountId` is never the tenant identity. Switching replaces each subscription and clears its displayed old view. |
| Reverse server order    | The next list response follows server order. Apollo merges entity fields by composite identity, preserving each invoice's correct amount/name.                                                                        |
| Fail next request       | The next accepted GraphQL operation returns HTTP 503 once. A failed narrow refresh leaves cached values intact; retry manually to recover. No automatic retry policy is added to this baseline.                       |
| Delay responses 1s      | Read data is captured before the delay. Switching tenants while an A refresh is pending cannot populate B's view with A's data. Same-tenant response ordering remains a later comparison scenario.                    |
| Save and refresh        | Save INV-1's edited account ID. Mutation returns identity only; a subsequent narrow query updates both views. The input is a local draft, not a full reactive-forms integration.                                      |
| Unmount / mount monitor | Disposes/recreates that component's own subscription. The other watcher remains active; remount uses the shared cache.                                                                                                |
| Reset experiment        | Resets fixtures, delay/failure settings, server request log, and Apollo cache; active queries reload.                                                                                                                 |

## StateQL views

In StateQL mode, the workspace uses `billingInvoices` from `src/data/stateql-definitions.ts`. The monitor derives a smaller view using `billingInvoices.select({ accountId: true }).extend({ status: true })`. This leaves the central definition unchanged. Both bind the same tenant argument and scope, so they address one shared resource. Identity fields come from generated schema metadata. There is no handwritten narrow GraphQL document or separate cache key.

`provideBillingClient` supplies the environment-owned client. Each `StateQLPanel` uses `injectStateQuery` with reactive tenant arguments and owns only its handle. Two mounted views share the initial read; mounting the monitor later reuses cached fields. A focused integration test also mounts the smaller feature first and verifies that adding the workspace fetches only its missing fields. Changing tenants hides the previous projection and replaces the handle. Unmounting the monitor releases its owner while the workspace continues to function.

| Control                 | StateQL behavior                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change server data      | Changes fixture values without touching shared client state.                                                                                                                              |
| Refresh account IDs     | Calls the workspace's `invalidate('accountId')`; the generated request contains that field plus identity/context. Both views update while amounts and names stay cached.                  |
| Refresh all fields      | Calls `invalidate()` on the central definition, retaining existing list membership/order.                                                                                                 |
| Reverse server order    | Changes server order only. A narrow field refresh still patches records by identity in cached order.                                                                                      |
| Refresh list membership | Calls `refreshList()` using the workspace's full selection, adopting server membership/order and refreshing selected values.                                                              |
| Fail next request       | A failed read preserves cached values and exposes errors. Both comparison modes use manual retry; the library's default bounded retry policy is disabled only in this demo configuration. |
| Delay responses 1s      | Makes tenant replacement observable. Old requests cannot populate the new tenant's view.                                                                                                  |
| Unmount / mount monitor | Destroys/recreates an owned query; the other view stays active and cached data is reused.                                                                                                 |
| Reset experiment        | Resets the shared fixture then reloads the app, discarding all tenant caches and owners. Starts again at tenant A.                                                                        |

The same inspector displays actual `StateQLRead` documents and response sizes. The app bundles both clients for this lab; its total bundle is not a standalone package-size comparison. Requests/logs from another open tab can affect counts because the fixture is shared. Use one tab and reset before comparing modes. The StateQL panel handles unavailable/incomplete data and field errors without treating missing values as zero or null. Readonly snapshots remain separate from form drafts; StateQL has no save UI yet.

## Boundaries and comparison

Central documents and fragments live in `apps/billing-demo/src/data/operations.ts`; cache identity policies live in `cache.ts`. `BillingService` coordinates Apollo operations. `FixtureService` and `RequestInspector` are shared by both modes and own development fixture controls and network evidence. Each `InvoicePanel` owns its watch subscription and cleanup. There is no second application cache or custom merge engine.

Apollo already supports the important narrow-fetch/shared-update behavior. This implementation explicitly maintains a broad document and a narrow document. StateQL's hypothesis is that one typed definition can derive these operations and refresh targets without that repeated application wiring. This milestone makes no claim that StateQL is superior or that Apollo lacks normalized updates.

Apollo's default list semantics also adopt incoming membership/order. StateQL field-refresh semantics preserve membership/order and flag unknown or missing records for a broad refresh. No custom Apollo policy has been added to conceal that difference; P5 must account for it in the comparison. This baseline covers fixed membership and reordering, not pagination or new/deleted records.

The schema and fixture are isolated from Apollo. The HTTP server binds loopback only, uses synthetic data, limits JSON bodies to 64 KiB, bounds retained request records to 100, and has no CORS support. Fixture controls are unauthenticated development tools; do not expose the server or dev proxy publicly.

## Tests and implementation notes

```sh
pnpm check
pnpm exec playwright install chromium
pnpm test:browser
```

The API suite checks tenant separation, save/null, reset, deterministic request/field failures, error paths, filtering, and malformed requests. The Apollo suite checks document validation, deduplication, independent watcher updates, narrow field coverage, preserved siblings, response size, reordering, tenant isolation, failure recovery, save, delayed scope changes, and owner teardown. StateQL demo tests exercise the actual central/feature definitions, request coverage, shared addresses, cached siblings, missing-field acquisition, and explicit list refresh. Browser scenarios exercise both Angular modes, the inspector, shared updates, error recovery, monitor remounting, tenant replacement, reset, and mobile width. P4.5 will extend this to the complete parity matrix, including forms. CI runs the normal suite on Linux/Windows and Chromium scenarios on Linux.

The demo uses supported Angular 21 with TypeScript 5.9, matching the repository's existing Node/TypeScript baseline. Apollo Angular 14 supports this combination. Application source and templates stay strict. Only the demo's external declaration checking uses `skipLibCheck`: Apollo Client 4.3.4's incremental-handler declarations conflict with `exactOptionalPropertyTypes`. The portable core retains full declaration checking. Incremental delivery is outside this demo.

Apollo operation result interfaces remain handwritten for the fixed baseline and validated with real schema/response tests. StateQL uses schema-generated definitions; `pnpm generate:billing` updates the planner example and demo from the same API schema, and `pnpm generate:check` verifies both outputs. No Changeset is needed because this milestone changes private demo applications and tooling, not the public core package.

References: [Apollo Angular setup](https://the-guild.dev/graphql/apollo-angular/docs/get-started), [Apollo normalized caching](https://www.apollographql.com/docs/react/caching/overview), [Angular version compatibility](https://angular.dev/reference/versions).

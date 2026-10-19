# StateQL

[![CI](https://github.com/jchewitt/stateql/actions/workflows/ci.yml/badge.svg)](https://github.com/jchewitt/stateql/actions/workflows/ci.yml)

GraphQL-first state management built around composable definitions and selective field refresh.

**Status: working Apollo baseline and StateQL automatic acquisition.** Typed definitions generate GraphQL requests and feed a shared record store with stable consumer snapshots. The client automatically reuses cached fields and fetches missing selections over HTTP. Broader response reconciliation, invalidation scheduling, and StateQL's Angular adapter remain planned; there is no published or production-ready package. The baseline establishes what Apollo already does before testing whether StateQL reduces application coordination work.

The intended behavior is illustrated below; this is a design example, not a currently available API:

```ts
const invoices = client.watch(billing.invoices, variables);
await invoices.invalidate('accountId');
```

The generated request should fetch the selected field plus necessary identity/context fields, update existing shared invoice state, and preserve unrelated cached fields. Central definitions, feature extensions, and consumer selections use one model. GraphQL generation and framework bindings remain separate from the shared-state runtime.

## Start contributing

Use Node 24 (CI also checks Node 22.14+) and pnpm 10.18.2. Install pnpm if needed with `npm install --global pnpm@10.18.2`.

```sh
git clone https://github.com/jchewitt/stateql.git
cd stateql
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` verifies formatting, strict TypeScript contracts and Angular templates, tooling and API/Apollo integration tests, production builds, and the actual packed library artifact installed into an isolated ESM/TypeScript consumer. Build products and package-check artifacts are ignored by Git.

## Run the billing experiment

```sh
pnpm demo
```

Open http://127.0.0.1:4200. Click **Change server data**, then **Refresh account IDs**: both views update while amounts and names stay cached. **Refetch full query** updates those remaining fields. Expand a request in the inspector to see the actual document, variables, and response size. Ports 4100 and 4200 must be free.

The [demo guide](docs/DEMO.md) explains tenant isolation, save, failure/recovery, delay, order changes, and the limits of the comparison. The fixture contains synthetic data and local development controls; it is not a production server.

Run the browser regression suite with the demo stopped:

```sh
pnpm exec playwright install chromium
pnpm test:browser
```

## Workspace

Run `pnpm demo:planner` after `pnpm check` to inspect generated full and narrow requests. The [planner guide](docs/PLANNER.md) covers schema generation, composition, addresses, and current limitations.

Run `pnpm demo:store` to see shared StateQL records update two differently selected consumers. The [store guide](docs/STORE.md) explains this first runtime chunk and the execution work still ahead.

Run `pnpm demo:acquire` for an actual StateQL HTTP acquisition against an isolated fixture, including shared initial loading and additional-field fetching. The [acquisition guide](docs/ACQUISITION.md) documents the API and supported response subset.

| Location                 | Current role                                                                 |
| ------------------------ | ---------------------------------------------------------------------------- |
| `packages/core`          | Shared records, projections, observation, canonical addresses and selections |
| `packages/graphql`       | Private typed schema generator and validated operation planner               |
| `packages/angular`       | Reserved Angular adapter; signals and lifecycle integration planned          |
| `apps/billing-api`       | Local GraphQL billing fixture and deterministic controls                     |
| `apps/billing-demo`      | Angular/Apollo baseline with two consumers and request inspector             |
| `examples/query-planner` | Runnable plain TypeScript operation planning example                         |
| `scripts`, `tests`       | Package/release checks and Angular browser scenarios                         |

Core has no runtime, UI-framework, GraphQL, or platform dependency. The initial package identifier `@jchewitt/stateql-core` is provisional until npm scope ownership is confirmed. It is not a claim that the npm scope has been reserved.

## Plan and delivery

- [Architecture and proof-of-concept plan](PLAN.md)
- [Task breakdown and acceptance criteria](docs/TASKS.md)
- [Architecture decisions](docs/DECISIONS.md)
- [Contribution and review process](CONTRIBUTING.md)
- [npm release process](docs/RELEASING.md)

GitHub Actions checks Linux and Windows. A manually dispatched prerelease workflow uses npm trusted publishing and provenance after npm account setup. Publishing remains disabled for the scaffold by a tracked readiness flag and version checks. No registry token is stored in this repository.

## License

[MIT](LICENSE), the same license type used by [TanStack Query](https://github.com/TanStack/query/blob/main/LICENSE) and [Apollo Client](https://github.com/apollographql/apollo-client/blob/main/LICENSE). StateQL is an independent project and is not affiliated with either.

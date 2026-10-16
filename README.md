# StateQL

[![CI](https://github.com/jchewitt/stateql/actions/workflows/ci.yml/badge.svg)](https://github.com/jchewitt/stateql/actions/workflows/ci.yml)

GraphQL-first state management built around composable definitions and selective field refresh.

**Status: repository foundation.** The query engine and Angular demonstration are not implemented yet. There is no published or production-ready package. The first milestone establishes an idiomatic Apollo baseline before testing whether StateQL reduces the work of coordinating selections, shared state, and targeted refreshes.

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

`pnpm check` verifies formatting, strict TypeScript contracts, tooling tests, library compilation, and the actual packed artifact installed into an isolated ESM/TypeScript consumer. Build products and package-check artifacts are ignored by Git.

## Workspace

| Location           | Current role                                                           |
| ------------------ | ---------------------------------------------------------------------- |
| `packages/core`    | Buildable ESM/declaration package with portable observation interfaces |
| `packages/graphql` | Reserved source boundary; implementation follows the baseline          |
| `packages/angular` | Reserved Angular adapter; signals and lifecycle integration planned    |
| `apps`             | Future shared billing API and Apollo/StateQL demo                      |
| `examples`         | Future plain TypeScript usage                                          |
| `scripts`, `tests` | Package verification and release-policy checks                         |

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

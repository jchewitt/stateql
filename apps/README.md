# Proof of concept applications

`billing-api` owns the GraphQL schema, synthetic billing fixtures, and deterministic controls. `billing-demo` is an Angular app using Apollo Angular, reusable GraphQL fragments, composite cache identities, and two independent query watchers.

Run both with `pnpm demo` from the repository root. See the [demo guide](../docs/DEMO.md). Both applications are private workspace packages; neither is published to npm. The later StateQL implementation will use the same fixture. See [tasks](../docs/TASKS.md).

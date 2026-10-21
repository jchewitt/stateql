# Proof of concept applications

`billing-api` owns the GraphQL schema, synthetic billing fixtures, and deterministic controls. `billing-demo` provides Apollo and Tandrove modes against that server. Apollo uses reusable fragments and composite cache identities; Tandrove uses central and feature-derived definitions, generated requests, and owned Angular queries. Both have independent consumers and the same request inspector.

Run both with `pnpm demo` from the repository root. See the [demo guide](../docs/DEMO.md). Both applications are private workspace packages; neither is published to npm. Both modes include two independent reactive-form editors with shared draft/save policy and client-specific read bindings. See [tasks](../docs/TASKS.md).

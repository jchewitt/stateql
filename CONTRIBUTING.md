# Contributing

StateQL is in the repository-foundation stage. Choose a small task from [the task list](docs/TASKS.md), read the architecture plan, and keep implementation focused on its acceptance criteria.

Use a branch and a pull request for subsequent feature work. Explain the resulting behavior and any limits; include examples of generated requests for selection or invalidation changes. Add a Changeset with `pnpm changeset` when changing package behavior or its exported API.

Before each commit, obtain an independent review agent's review, resolve actionable findings, and re-review changed code. Record the outcome. This requirement applies to generated scaffolds and workflow changes as well as runtime code.

Run `pnpm check`. As runtime code grows, add behavioral unit tests, schema validation tests, type inference tests, and deterministic concurrency tests. Browser tests will be added with the Angular demo. Current tests validate the foundation and packaging; they do not establish runtime cache correctness.

`pnpm format` applies formatting. `pnpm build` cleans the package output and compiles declarations and ESM. `pnpm pack:check` keeps tarballs under ignored `.artifacts/` and installs one into a temporary consumer outside the repository so workspace dependencies cannot mask packaging defects. It removes the temporary consumer afterward.

Commit source, configuration, and `pnpm-lock.yaml`; do not commit `dist`, `node_modules`, or `.artifacts`. The MIT license applies to contributions.

# Repository instructions

- Read `PLAN.md`, `docs/DECISIONS.md`, and the relevant item in `docs/TASKS.md` before implementation.
- Keep the code organized as a reusable library. Use strict TypeScript interfaces and inferred types; keep internal source interfaces provisional rather than exposing a generic plugin framework prematurely.
- Core must not import Angular, React, RxJS, GraphQL, HTTP clients, or browser globals. The GraphQL source owns operation construction and decoding. Framework adapters own reactive presentation and lifecycle cleanup.
- Derive cache addressing and operations from one canonical definition. Do not introduce separately maintained query-key mappings.
- Add tests for observable behavior and important failure modes. Run `pnpm check` before committing. Add relevant scenario tests as runtime features arrive.
- **An independent review agent must review the candidate changes before every commit.** Address actionable findings and request re-review of fixes before committing. Record the review and validation evidence in the commit/PR context or `docs/reviews/`. Do not substitute self-review for this requirement.
- Keep the task list accurate. Do not present a proposed API or reserved module as implemented.
- Use Changesets for package behavior/API changes. Never publish the scaffold or change npm scopes casually. Follow `docs/RELEASING.md` for release readiness, account configuration, and validation.
- Keep credentials, local artifacts, generated builds, and caches out of Git. Avoid committing unrelated changes.

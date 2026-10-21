# Experimental npm releases

## Current release status

All three `0.1.0-alpha.0` packages were published locally and passed exact-artifact verification and isolated npm installation checks on October 21. They have no CI provenance. The next candidate is `0.1.0-alpha.1`, tag `tandrove-v0.1.0-alpha.1`, for the first real trusted-publishing run. The user reports trust configured for the packages; CI execution remains the acceptance gate. The bootstrap instructions below document the completed alpha.0 process; do not run them again for alpha.1.

Publication and read-only verification now wait up to 20 minutes for npm processing, checking every 30 seconds without repeating uploads. A missing or wrong `RELEASE_TAG` reports the expected value. Set it in each terminal session. Registry installation checks also run `npm audit signatures` against locked isolated installs to validate registry signatures and available provenance attestations. The CI publication path separately requires provenance metadata for every Tandrove package.

Tandrove is the library previously developed as StateQL. The user secured the `@tandrove` scope before any package publication. The GitHub repository is now `jchewitt/tandrove`, including repository metadata and trusted-publisher settings. The older `stateql-v0.1.0-alpha.0` tag and its saved tarballs are superseded preparation artifacts: do not publish them. Use only the new `tandrove-v0.1.0-alpha.0` release set below.

The first release candidate is **0.1.0-alpha.0** for `@tandrove/core`, `@tandrove/graphql` and `@tandrove/angular`, published in that order to **next**. These are functioning standalone libraries; server companions, streaming and hosting are not prerequisites. Publication and npm account setup remain separate from preparing and reviewing the candidate.

All three packages ship ESM JavaScript and optional TypeScript declarations. Core has no framework/platform dependencies. GraphQL requires GraphQL 16.14.2 or a compatible 16.x release; Angular requires Angular 21.2.25 or a compatible 21.x release and the matching Tandrove core alpha. Node tooling requires Node >=22.14.0; release CI uses Node 24 and pnpm 10.18.2. See the [GraphQL subset](PLANNER.md#supported-boundary), [JavaScript examples](VANILLA.md), [Angular integration](ANGULAR.md) and [comparison](COMPARISON.md).

The alpha supports shared caching, generated GraphQL reads, field/branch invalidation, explicit list refresh, local request race protection, bounded read retries and Angular observation/query ownership. Snapshot payloads are immutable JSON projections. Low-level source/ingest interfaces remain provisional. Forms draft helpers belong to the demo, not the public library. Polling/stale timers, real socket delivery, server revisions, persistence, offline writes, React and production REST/server adapters remain planned. Alpha changes may break APIs; each release must document changes and migration requirements. Keep dependent Tandrove packages on the same tested alpha.

Follow the [usable incremental release gates](../PLAN.md#usable-incremental-releases). Publish integrations only with runnable behavior and installed-consumer acceptance, while preserving standalone client usage.

## First publication: account-owner handoff

No new clone is required when using the prepared checkout. From another computer, clone `https://github.com/jchewitt/tandrove.git`, fetch tags, check out `tandrove-v0.1.0-alpha.0`, install with `pnpm install --frozen-lockfile`, and prepare the artifacts as below. Use Node 24 and pnpm 10.18.2.

1. Sign in to npm with an account authorized to publish public packages in `@tandrove`. If this is an organization scope, its owner must grant that access. Enable account 2FA. Scope selection alone does not prove ownership.
2. In your own terminal, run `npm login --registry=https://registry.npmjs.org/` and `npm whoami --registry=https://registry.npmjs.org/`. Complete npm's browser/2FA prompts; never put credentials in Git or chat.
3. Use the reviewed tagged checkout and prepare the release. PowerShell commands from the repository root:

   ```powershell
   $env:RELEASE_TAG = 'tandrove-v0.1.0-alpha.0'
   pnpm release:prepare
   ```

   This runs release preflight and the full checks, then writes tarballs and their source revision/SHA512 manifest to `.artifacts/release/tandrove-v0.1.0-alpha.0/`. Preparation does not publish. If the handoff already prepared this directory at the same clean commit, use those artifacts.

4. Publish the reviewed artifacts interactively:

   ```powershell
   pnpm release:bootstrap
   pnpm release:verify
   pnpm pack:check --registry
   ```

   Bootstrap checks every existing registry version before publishing any missing package, then publishes core, GraphQL and Angular in dependency order with public access and the `next` tag. Complete any npm 2FA prompts. This is the step that makes the packages public. It publishes the saved tarballs; Angular uses its built APF output, never the source workspace directory.

5. Return the command outcomes. `release:verify` checks registry versions/integrity; `pack:check --registry` installs the exact alpha versions from the public registry in isolated JavaScript, TypeScript and Angular consumers, without substituting local tarballs. Until both checks pass, R1 registry acceptance remains open.

The first local publication does **not** have GitHub build provenance. Do not describe it as OIDC-published or attempt to republish the same version through CI. Later versions use the trusted workflow and provenance. Never publish a `0.0.0` scaffold just to create package settings.

npm also supports [staged publishing](https://docs.npmjs.com/staged-publishing/) for new packages, with a public `0.0.0-stage` placeholder and separate approval. This release uses direct first publication of the tested alpha; staging is not a hidden step in these scripts. See [npm's public scoped-package instructions](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).

## Trusted publishing after bootstrap

In npm's Settings → Trusted Publisher for **each** of the three packages, choose GitHub Actions and enter:

| Setting              | Value                                |
| -------------------- | ------------------------------------ |
| Organization or user | `jchewitt`                           |
| Repository           | `tandrove`                           |
| Workflow filename    | `publish.yml`                        |
| Environment name     | `npm`                                |
| Allowed action       | Direct publishing with `npm publish` |

The GitHub environment `npm` has been created in `jchewitt/tandrove`. A required reviewer can be configured by the repository owner if desired. No npm token secret is needed. The default stage-only permission in newer npm settings is insufficient for this direct-publish workflow.

Configure trust when the next reviewed alpha is ready: npm currently requires a newly configured publisher to complete its first successful publish within **two days**, or it must be recreated. Do not manufacture or republish an existing version merely to validate trust. Check these settings against [npm's current trusted-publishing documentation](https://docs.npmjs.com/trusted-publishers/) when setting them up. The workflow's npm 11.6.2 and Node 24 exceed the documented minimum versions.

## Subsequent reviewed releases

1. Add Changesets for package behavior/API changes. The initial release enters prerelease mode `alpha`; retain it for subsequent alphas. Run `pnpm version:packages`, review versions and changelogs, and update exact prerelease peers consistently. See [.changeset/README.md](../.changeset/README.md).
2. Keep the three packages as one tested release set. Check all manifests, packed dependencies and Angular APF metadata. Stable versions and `latest` require a separately reviewed policy change.
3. Run `pnpm check`, obtain independent agent review, and merge the release PR only after hosted CI passes. Readiness in `release.config.json` permits only validated alpha candidates; it does not trigger publication.
4. Tag the reviewed main commit `tandrove-v<VERSION>` and push the tag. Never move a published tag.
5. Dispatch **Publish experimental Tandrove** from `main`, supplying that exact tag. The tag must identify the current main commit at dispatch; if main has advanced, create another reviewed release candidate instead of publishing with misleading provenance.
6. The workflow installs locked dependencies, runs `release:prepare`, publishes the saved tarballs with OIDC/provenance, verifies registry integrity, and runs `pnpm pack:check --registry` for clean installed consumers. It never runs on ordinary pushes or PRs. Check the run and provenance for all three packages before announcing the release.

The guard requires a clean checkout, a version-matching tag contained in `origin/main`, and, in GitHub Actions, a checked-out commit equal to the workflow's `GITHUB_SHA`. This ties provenance to the actual source. Core/GraphQL ship their compiled modules; Angular ships `packages/angular/dist` with partial compilation and matching core peer metadata.

## Failure handling

A network error can follow a successful publish. Preserve the prepared artifacts and run verification before retrying. Registry preflight treats only an explicit 404 as absent; authentication/network failures stop the operation. Existing versions must match the expected SHA512 integrity, and `next` must resolve to that version and integrity. The CI path additionally requires registry provenance metadata. That metadata check is not cryptographic attestation verification; after CI publication, inspect npm provenance for the source revision and run `npm audit signatures` in a clean installed consumer. An incompatible existing version stops the entire preflight before any further package is published. Never overwrite/delete a version or silently accept different contents.

If some packages succeeded, rerun the same publication command against the same reviewed artifacts. Verified existing packages are skipped; missing ones are published in order. A moved `next` tag stops resumption without changing registry tags. CI uploads artifacts from each attempt for inspection. A CI rerun rebuilds the reviewed source; differing bytes stop publication at the integrity check. There is no automatic cross-run artifact restore. Bootstrap versions without provenance cannot be resumed as CI releases. A content mismatch requires investigation and usually a new reviewed prerelease, not forcing publication. Registry verification does not prove account permissions for missing packages; npm may reject publication and leave a partial set to resume.

Record the actual publication, provenance and clean-install results in release notes. Do not mark registry verification complete based only on local tarball tests.

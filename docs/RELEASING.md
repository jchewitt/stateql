# Experimental npm releases

The workflow is prepared; publishing is not enabled for the scaffold. `release.config.json` has `ready: false`, and version `0.0.0` is rejected. The current package only contains contracts. Do not publish it as a working state-management library.

## Registry setup

The GitHub account is `jchewitt`. npm is not authenticated in the setup environment, and the matching npm scope is not verified. Confirm ownership of `@jchewitt` or choose an owned scope before release. Update manifests, release configuration, package checks, fixtures, and documentation together if the scope changes.

Establish the package using npm's current new-package/account flow, then configure its trusted publisher. The target settings are GitHub owner `jchewitt`, repository `stateql`, workflow filename `publish.yml`, and environment `npm`. Enable direct publish permission if npm's settings require it. Scope creation and initial package setup may need account-owner interaction; no stored token or registry setup is implied by the GitHub workflow.

The workflow uses Node 24 and npm 11.6.2, above the documented trusted-publishing minimum, and requests OIDC permission only in the publish job. See [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/). The public repository and `--provenance` support publication provenance. No `NPM_TOKEN` secret is expected.

## Version and review

1. Complete the useful package functionality and release acceptance tasks in `docs/TASKS.md`.
2. Enter prerelease mode with `pnpm exec changeset pre enter alpha`.
3. Add an appropriate Changeset with `pnpm changeset`, then run `pnpm version:packages`. Verify the result is at least `0.1.0-alpha.0`, not a `0.0.x` scaffold release.
4. Review the changelog and package payload. Set `ready: true` in `release.config.json` only in the reviewed release change.
5. Run `pnpm check`, obtain independent review, commit, and merge through a pull request with passing CI.
6. Tag that reviewed main-line commit as `core-v<VERSION>` (for example `core-v0.1.0-alpha.0`) and push the tag.
7. Dispatch **Publish experimental core** from `main`, supplying the exact release tag. The tag must identify the current main commit at dispatch time; publish before main advances or create a new reviewed prerelease at its new tip.

The workflow checks out the tag, verifies its version and ancestry on `origin/main`, and requires HEAD to match GitHub's workflow SHA so npm provenance describes the code actually published. It also requires a clean checkout, runs the full checks, and publishes to `next`. It does not publish on normal pushes or pull requests. Run the preflight locally on the tagged checkout using the `RELEASE_TAG` environment variable and `pnpm release:check`.

The initial workflow releases only core. Add package-specific tagging, dependency ordering, and actual build verification when the GraphQL and Angular packages become releasable. Do not publish empty package shells. Stable `latest` releases require a separate reviewed policy change.

## Failure handling

If publication fails, first inspect the npm registry for the exact version; a network failure can occur after a successful publish. Never assume absence, delete a release, or reuse a published version. Confirm the version's contents/provenance and complete any remaining documentation, or create a new corrected prerelease through Changesets. Record registry verification in the release notes.

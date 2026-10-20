# Experimental npm releases

The workflow is prepared; publishing is not enabled. `release.config.json` has `ready: false`, and version `0.0.0` is rejected. Core and GraphQL now implement the experimental acquisition runtime, and Angular has its initial observation package. Release acceptance and account setup are still required.

Follow the [usable incremental release gates](../PLAN.md#usable-incremental-releases). The first alpha is a functioning standalone core/GraphQL/Angular release set, not a shell waiting for streaming or hosting. Each later integration publishes only when its own installed example, lifecycle/recovery scenarios and compatibility contract work. Preserve client-only operation and the same recognizable client/server provider/group/resource setup pattern throughout.

The user requested a release-readiness notification and will configure npm trusted publishing at that handoff. Notify them once P4's integration/forms scenarios, P5's comparison decision, and package acceptance checks pass. Before publication, confirm the approved package names/versions and finish CI automation for that release set. The existing core-only scaffold is not yet the complete core/GraphQL/Angular release pipeline. Do not request registry changes merely to continue ordinary feature work.

At handoff, provide the exact owner, repository, workflow filename and optional environment used by the final workflow, plus which npm packages need trust configuration. Recheck npm's current setup requirements then. CI should perform verified versioned publication and registry/provenance checks after that configuration, rather than require local registry credentials.

## Registry setup

The GitHub account is `jchewitt`. The user selected the npm scope `@launch-echo` on October 20. Intended release packages are `@launch-echo/stateql-core`, `@launch-echo/stateql-graphql` and `@launch-echo/stateql-angular`. npm account access to that scope is not yet verified. Existing manifests/imports still use `@jchewitt`; R1 must migrate manifests, peers, source imports, generated modules, fixtures, Changesets configuration, package/release checks and documentation together before publication. Do not re-ask which scope the user selected; verify access and resolve only actual conflicts.

Establish the package using npm's current new-package/account flow, then configure its trusted publisher. The target settings are GitHub owner `jchewitt`, repository `stateql`, workflow filename `publish.yml`, and environment `npm`. Enable direct publish permission if npm's settings require it. Scope creation and initial package setup may need account-owner interaction; no stored token or registry setup is implied by the GitHub workflow.

The workflow uses Node 24 and npm 11.6.2, above the documented trusted-publishing minimum, and requests OIDC permission only in the publish job. See [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/). The public repository and `--provenance` support publication provenance. No `NPM_TOKEN` secret is expected.

## Version and review

The commands and tag/workflow names below describe the current core-only scaffold. R1.2a must replace this section with the reviewed three-package procedure before the first release; do not dispatch the scaffold as though it publishes the complete release set. Exact versions and the final tag policy remain to be set in that release change.

1. Complete the useful package functionality and release acceptance tasks in `docs/TASKS.md`.
2. Enter prerelease mode with `pnpm exec changeset pre enter alpha`.
3. Add an appropriate Changeset with `pnpm changeset`, then run `pnpm version:packages`. Verify the result is at least `0.1.0-alpha.0`, not a `0.0.x` scaffold release.
4. Review the changelog and package payload. Set `ready: true` in `release.config.json` only in the reviewed release change.
5. Run `pnpm check`, obtain independent review, commit, and merge through a pull request with passing CI.
6. Tag that reviewed main-line commit as `core-v<VERSION>` (for example `core-v0.1.0-alpha.0`) and push the tag.
7. Dispatch **Publish experimental core** from `main`, supplying the exact release tag. The tag must identify the current main commit at dispatch time; publish before main advances or create a new reviewed prerelease at its new tip.

The workflow checks out the tag, verifies its version and ancestry on `origin/main`, and requires HEAD to match GitHub's workflow SHA so npm provenance describes the code actually published. It also requires a clean checkout, runs the full checks, and publishes to `next`. It does not publish on normal pushes or pull requests. Run the preflight locally on the tagged checkout using the `RELEASE_TAG` environment variable and `pnpm release:check`.

The initial workflow releases only core. Add package-specific tagging, dependency ordering, and actual build verification when the GraphQL and Angular packages become releasable. Do not publish empty package shells. Stable `latest` releases require a separate reviewed policy change.

The Angular prototype remains private. Its APF artifact lives in `packages/angular/dist`; package checks pack that generated directory, not its workspace source manifest. Before any future Angular release, update the exact experimental core peer version alongside package versioning and validate the installed artifact again.

## Failure handling

If publication fails, first inspect the npm registry for the exact version; a network failure can occur after a successful publish. Never assume absence, delete a release, or reuse a published version. Confirm the version's contents/provenance and complete any remaining documentation, or create a new corrected prerelease through Changesets. Record registry verification in the release notes.

# R1 initial alpha preparation review

Candidate: `release/initial-alpha`, based on `8062a74`; three packages under `@launch-echo` at `0.1.0-alpha.0`, intended tag `stateql-v0.1.0-alpha.0` and dist-tag `next`. This record covers preparation, not a completed npm publication.

## Independent review

Reviewer: `/root/release_review`, independent of the package migration and pipeline implementation agents. Reviewed scope migration, generated imports, public/peer dependency metadata, Angular APF exports, Changesets state, package docs, release scripts, workflow, tests and handoff.

Actionable findings resolved and re-reviewed:

- Removed proposed cross-run artifact restoration; a downloaded manifest's claimed source revision cannot establish trust in its bytes. CI rebuilds reviewed source and fails on any registry integrity mismatch.
- Restricted release policy to numbered alpha versions and verified `next` alongside exact version integrity before resume and after publication.
- Matched the workflow name to the handoff and added source-directory publish guards for all three packages.
- Distinguished registry provenance metadata presence from cryptographic verification, and documented bootstrap provenance limits and CI rebuild failure handling.

The reviewer reported no remaining actionable findings and independently passed all 34 release/workspace tests and `git diff --check`. Final review includes the source publish guards and handoff corrections.

## Local validation

- `pnpm check` passed: formatting, builds, generated schema check, typechecking, runtime/tooling tests and isolated tarball consumers.
- After the final source publish-guard/test changes, formatting and the 34 release/workspace tests passed again. The full check's package-consumer stage included the updated manifests.
- Package-agent checks passed native JavaScript, checked JavaScript, TypeScript and Angular native ESM/AOT consumers against actual installed tarballs; all 184 runtime/example tests passed.
- Pipeline tests cover complete-set preflight, dependency order, ambiguous publication failures/resume, registry errors, content mismatch, absent provenance, moved `next` tags, alpha/version guards and APF validation. Actual freshly packed artifacts passed the release inspector.
- A temporary Changesets dry plan confirmed a new patch advances the fixed three-package group to `0.1.0-alpha.1`; private demos remain at `0.0.0`.

Initial Changesets output was normalized to the intended `0.1.0-alpha.0` because its exact-peer propagation produced a major version. The adjustment and subsequent version-review requirement are documented in `.changeset/README.md`.

## External acceptance still required

At candidate review, hosted PR CI and tagged artifact preparation run after this reviewed commit. Their results belong in the PR/handoff. The GitHub `npm` environment exists. Public registry lookups returned 404 for all three names; local `npm whoami` returned `ENEEDAUTH`. These checks do not establish scope ownership.

The user must complete npm account authentication and initial interactive publication, then configure trust when the next reviewed alpha is ready. No registry writes were performed. Registry metadata, clean registry-installed JS/TS/Angular consumers, and authenticated CI/provenance verification remain open R1 tasks. Local tests never substitute for those results.

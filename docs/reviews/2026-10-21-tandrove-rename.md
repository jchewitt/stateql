# Tandrove prepublication rename review

Candidate branch: `release/tandrove-alpha`, based on `1b4aa1584e632e59e00d9b7d25d3e37961f8b2ec`.

## Scope

Rename the unpublished alpha to `@tandrove/core`, `@tandrove/graphql` and `@tandrove/angular`, including branded Angular APIs, package outputs, generated imports, demos, current documentation, Changesets and release guards. Retain version `0.1.0-alpha.0` and the `next` distribution tag. Complete the user's GitHub rename to `jchewitt/tandrove`; preserve historical decisions, review reports, measurements and the old release tag/artifacts.

Add exact-version public-registry consumer acceptance with `pnpm pack:check --registry` and run it after trusted publication in CI. Registry consumers install the published packages in temporary directories outside the workspace; they do not fall back to local tarballs.

## Independent review

The independent `tandrove_review` agent reviewed the implementation and repository-metadata follow-up and reported no actionable code findings. It independently passed all 36 release/workspace tests and whitespace checks. The reviewer independently confirmed the canonical GitHub repository, updated origin and npm environment and approved the final candidate for commit. No commit or publication has occurred for this candidate.

## Validation

- Frozen lockfile installation passed.
- `pnpm check` passed before and after the repository-metadata update: formatting, all builds, generated-schema verification, strict types/templates, 220 tests, and isolated tarball JavaScript/TypeScript/Angular acceptance.
- The first browser run passed 24 scenarios and failed one Apollo initial-render setup. The saved trace shows Chromium failed to load `main.js` with `net::ERR_NO_BUFFER_SPACE`; the application did not start or issue a GraphQL request. No application fix was made on that evidence.
- The full browser rerun passed all 25 scenarios, including Apollo and Tandrove tenant switching and form ownership.
- Public-registry checks found all three old and all three new package names unpublished before this change. Registry-installed acceptance remains pending actual publication.

## Remaining release gates

GitHub confirmed the canonical repository is `jchewitt/tandrove` and the `npm` environment exists. The local origin now uses `https://github.com/jchewitt/tandrove.git`, and fetching from it succeeded. Independent approval of this confirmation was completed before committing. Hosted CI, merge, the fresh `tandrove-v0.1.0-alpha.0` tag and prepared artifact set remain pending. This machine returned npm `ENEEDAUTH`; account-owner login is required before bootstrap. Trusted-publisher configuration, actual publication, integrity verification and registry-installed consumer acceptance remain separate release gates.

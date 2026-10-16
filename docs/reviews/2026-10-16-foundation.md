# Foundation review

Independent review agent: `foundation_review`. Reviewed before the initial commit on October 16, 2026. Scope: portable interfaces, repository configuration, build/package tooling, CI, release workflow, and milestone documentation.

## Findings and resolution

| Finding                                                                                          | Resolution                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1: A manually selected older tag could publish code different from GitHub's provenance revision | GitHub releases now require checked-out HEAD to equal the workflow dispatch SHA, as well as tag/version agreement and main ancestry. Added mismatch and missing-revision tests. |
| P2: A consumer beneath the repository could inherit undeclared workspace dependencies            | Install the tarball into a temporary directory outside the repository and clean up that exact directory afterward.                                                              |
| P2: TypeScript compilation could leave obsolete output in the published package                  | Clean the verified package output directory before compilation. Plant a stale-output probe during packaging verification and require it to be absent from the tarball.          |

The independent agent re-reviewed all three fixes and reported no actionable blockers for the foundation commit. It independently reran the tooling tests: 16 passed.

## Validation

Local `pnpm check` passed: formatting, strict TypeScript and negative type assertions, 16 tooling tests, clean ESM/declaration compilation, package allowlist/license checks, and external consumer import/type checking.

Hosted results are recorded in [GitHub Actions](https://github.com/jchewitt/stateql/actions/workflows/ci.yml) after push. npm scope ownership, package creation, and trusted-publisher account configuration remain prerequisites for the first actual release. No package was published during repository setup.

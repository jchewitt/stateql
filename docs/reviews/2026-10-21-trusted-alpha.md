# Trusted-publishing alpha candidate

Candidate `0.1.0-alpha.1` follows the successfully published and registry-tested local alpha.0. The user configured npm trusted publishing and authorized exercising the real CI release flow. No library runtime API changes are included.

Changesets generated synchronized versions and Angular's exact core peer. Release tooling polls explicit registry absence with a shared 20-minute waiting budget and never retries uploads. Conflicting metadata, missing required provenance and registry/network errors stop immediately. Missing release-tag configuration now identifies the expected value. CI has a 45-minute job budget and runs registry-installed consumers plus `npm audit signatures` with temporary lockfiles.

Initial validation passed `pnpm check`: 223 tests, builds, generated definitions, strict types/templates and isolated tarball consumers. The independent reviewer passed all 39 tooling tests and identified misleading current publication status and local provenance wording; both were corrected. Final review and final validation are recorded in the commit/PR context before commit.

Actual CI OIDC authorization, published alpha.1 integrity/provenance, and registry-installed acceptance remain pending. Alpha.0 artifacts and tags remain immutable. npm processing delays are expected; timeout recovery uses read-only verification of preserved artifacts, not blind republication.

# Installation index propagation follow-up

The first alpha.1 workflow attempt published all three packages through OIDC with valid provenance, then failed npm installation because the install index lagged the direct version endpoints. Attempt 2 passed end to end, preserving the exact published artifacts and skipping uploads. Local installed JS/TS/Angular checks and signature/attestation checks also passed. See [the run](https://github.com/jchewitt/tandrove/actions/runs/39658759688).

The follow-up separates publication preflight from installation acceptance: direct endpoints detect accepted versions, while post-upload/read-only availability polls use the installation index. Registry consumers use `--prefer-online`. The reviewer caught an initial design that used the lagging index for publication preflight; this was corrected and a regression test asserts zero uploads when direct versions exist but the index lags.

Tooling tests cover HTTP failures, missing indexed versions/tags, malformed indexes, mismatches, timeout bounds and read-only waiting. Final checks and independent approval are recorded in the commit/PR context. Package versions and release tags are unchanged; this is tooling and completion documentation for future releases.

# Changesets

Use `pnpm changeset` for package behavior or API changes. Use Changesets prerelease mode for the first experimental releases; see [releasing](../docs/RELEASING.md).

Core, GraphQL and Angular form one fixed release group. The initial standalone release is `0.1.0-alpha.0` under `@tandrove`; prerelease mode remains active for subsequent alpha changesets. The first generated release was normalized to that intended version because Changesets treats a changed exact core peer as a major bump for Angular. Review the resulting version and update Angular's exact core peer together on every versioning run; never publish a generated major version accidentally. The release checks require matching versions.

The accumulated changesets describe the implementation milestones in their original order. References to private prototypes or work deferred at those milestones are historical; the package READMEs describe the current release. After feature merges, the bot runs `pnpm version:release` and maintains one release PR. Review its generated versions and changelogs; an approval on the current revision and passing CI gate automatic tagging and publication after merge. See [the release process](../docs/RELEASING.md#subsequent-reviewed-releases). Do not manually run versioning in feature PRs.

The prepublication Tandrove rename is recorded in `tandrove-prepublication-rename` and included in `pre.json.changesets` because its changelog is already incorporated into the initial `0.1.0-alpha.0` candidate. Do not run versioning just to apply this rename; it does not represent a second published alpha.

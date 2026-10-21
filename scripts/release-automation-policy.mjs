export const releaseBranch = 'changeset-release/main';
export const requiredChecks = [
  'Verify (ubuntu-latest, Node 22)',
  'Verify (ubuntu-latest, Node 24)',
  'Verify (windows-latest, Node 24)',
  'Angular browser scenarios',
];

/** An ordinary main merge must never authorize publication. */
export function validateReviewedRelease({
  pr,
  reviews,
  checks,
  files,
  sha,
  repository,
}) {
  if (
    !pr.merged ||
    pr.merge_commit_sha !== sha ||
    pr.base?.ref !== 'main' ||
    pr.head?.ref !== releaseBranch ||
    pr.head?.repo?.full_name !== repository ||
    pr.base?.repo?.full_name !== repository ||
    pr.user?.login !== 'github-actions[bot]'
  )
    throw new Error(
      'Automatic publication requires the merged bot release PR at this exact commit.',
    );
  if (
    !files.length ||
    files.some(
      (file) =>
        !/^(?:packages\/(?:core|graphql|angular)\/(?:package\.json|CHANGELOG\.md|README\.md)|\.changeset\/(?:pre\.json|[^/]+\.md)|pnpm-lock\.yaml|README\.md|docs\/ANGULAR\.md)$/.test(
          file.filename,
        ),
    )
  )
    throw new Error(
      'Release PR contains changes outside versioning, changelogs and versioned documentation.',
    );
  const latestReviews = new Map();
  for (const review of [...reviews].sort((a, b) => a.id - b.id)) {
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state))
      latestReviews.set(review.user?.login, review);
  }
  const trusted = (review) =>
    review.user?.type === 'User' &&
    ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(review.author_association);
  if (
    [...latestReviews.values()].some(
      (review) => trusted(review) && review.state === 'CHANGES_REQUESTED',
    )
  )
    throw new Error('Release PR has unresolved change requests.');
  if (
    ![...latestReviews.values()].some(
      (review) =>
        trusted(review) &&
        review.state === 'APPROVED' &&
        review.commit_id === pr.head.sha &&
        Date.parse(review.submitted_at) <= Date.parse(pr.merged_at),
    )
  )
    throw new Error(
      'Release PR needs a maintainer approval of its current head commit.',
    );
  for (const name of requiredChecks) {
    const matching = checks
      .filter(
        (check) =>
          check.name === name &&
          check.head_sha === pr.head.sha &&
          check.app?.slug === 'github-actions',
      )
      .sort((a, b) => b.id - a.id);
    if (
      matching[0]?.status !== 'completed' ||
      matching[0]?.conclusion !== 'success'
    )
      throw new Error(
        `Release head has no successful current CI check: ${name}.`,
      );
  }
}

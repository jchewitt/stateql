import semver from 'semver';
import { validateRelease } from './release-policy.mjs';
import { validateReviewedRelease } from './release-automation-policy.mjs';

export function planPublication({
  sha,
  repository,
  ref,
  workflowSha,
  eventName,
  requestedTag,
  config,
  manifests,
  readPrevious,
  resolveTag,
  api,
  pages,
}) {
  if (
    repository !== 'jchewitt/tandrove' ||
    ref !== 'refs/heads/main' ||
    sha !== workflowSha
  )
    throw new Error(
      'Publication planning must run at the exact main workflow commit.',
    );
  const version = manifests[0].version;
  const tag = 'tandrove-v' + version;
  validateRelease({ config, manifests, tag });
  const manual = eventName === 'workflow_dispatch';
  if (manual) {
    if (requestedTag !== tag)
      throw new Error(
        'Manual release tag does not match the checked-out version.',
      );
    if (resolveTag(tag) !== sha)
      throw new Error('Manual release tag must already point to this commit.');
  } else {
    if (eventName !== 'push') throw new Error('Unsupported publication event.');
    const previous = readPrevious();
    if (
      previous.length === manifests.length &&
      previous.every((value, index) => value === manifests[index].version)
    ) {
      return { publish: false };
    }
    if (
      previous.length !== manifests.length ||
      previous.some(
        (value) => !semver.valid(value) || !semver.gt(version, value),
      )
    )
      throw new Error('Every release package must advance its version.');
    const associated = pages(
      `repos/${repository}/commits/${sha}/pulls?per_page=100`,
    ).flat();
    const candidate = associated.find(
      (pr) =>
        pr.merge_commit_sha === sha &&
        pr.head?.ref === 'changeset-release/main',
    );
    if (!candidate)
      throw new Error(
        'Version change was not merged through the bot release PR.',
      );
    const pr = api(`repos/${repository}/pulls/${candidate.number}`);
    const reviews = pages(
      `repos/${repository}/pulls/${pr.number}/reviews?per_page=100`,
    ).flat();
    const files = pages(
      `repos/${repository}/pulls/${pr.number}/files?per_page=100`,
    ).flat();
    const checks = pages(
      `repos/${repository}/commits/${pr.head.sha}/check-runs?filter=latest&per_page=100`,
    ).flatMap((page) => page.check_runs);
    validateReviewedRelease({ pr, reviews, files, checks, sha, repository });
    const refs = api(`repos/${repository}/git/matching-refs/tags/${tag}`);
    const existing = refs.find((ref) => ref.ref === 'refs/tags/' + tag);
    if (existing) {
      const target =
        existing.object.type === 'tag'
          ? api(`repos/${repository}/git/tags/${existing.object.sha}`).object
          : existing.object;
      if (
        existing.object.type !== 'tag' ||
        target.type !== 'commit' ||
        target.sha !== sha
      )
        throw new Error(
          'Existing release tag differs from the reviewed commit; tags are never moved.',
        );
    } else {
      const annotated = api(`repos/${repository}/git/tags`, {
        tag,
        message: `Tandrove ${version}; reviewed release PR #${pr.number}`,
        object: sha,
        type: 'commit',
      });
      api(`repos/${repository}/git/refs`, {
        ref: 'refs/tags/' + tag,
        sha: annotated.sha,
      });
    }
  }
  return { publish: true, release_tag: tag };
}

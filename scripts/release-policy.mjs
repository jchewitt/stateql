import semver from 'semver';

/** npm provenance uses the workflow revision, so checkout must match it. */
export function validateWorkflowRevision({ head, workflowSha }) {
  if (!workflowSha || head !== workflowSha)
    throw new Error(
      'Release tag must match the exact workflow dispatch commit.',
    );
}

/** Validate a reviewed prerelease before any registry mutation. */
export function validateRelease({ manifest, config, tag }) {
  if (!config.ready)
    throw new Error('Package is not marked ready for release.');
  if (manifest.private) throw new Error('Private packages cannot be released.');
  if (manifest.name !== config.packageName)
    throw new Error('Package name does not match the release configuration.');
  if (
    !semver.valid(manifest.version) ||
    !semver.gte(manifest.version, '0.1.0-0') ||
    !semver.prerelease(manifest.version)
  )
    throw new Error(
      'Only experimental prereleases at or above 0.1.0 are enabled.',
    );
  if (tag !== `core-v${manifest.version}`)
    throw new Error('Release tag must exactly match the package version.');
  if (
    config.distTag !== 'next' ||
    manifest.publishConfig?.tag !== 'next' ||
    manifest.publishConfig?.access !== 'public' ||
    manifest.publishConfig?.registry !== 'https://registry.npmjs.org/'
  )
    throw new Error(
      'Releases must target the public npm registry and next tag.',
    );
  return { version: manifest.version, tag };
}

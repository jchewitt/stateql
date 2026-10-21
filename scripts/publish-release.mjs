import { join } from 'node:path';
import { checkRelease } from './check-release.mjs';
import {
  artifactDirectory,
  readPreparedRelease,
  runManager,
} from './release-artifacts.mjs';
import {
  publishReleaseSet,
  readRegistryVersion,
  registry,
} from './release-policy.mjs';

const args = process.argv.slice(2);
if (args.some((arg) => !['--bootstrap', '--verify'].includes(arg)))
  throw new Error('Supported options are --bootstrap or --verify.');
const bootstrap = args.includes('--bootstrap');
const verifyOnly = args.includes('--verify');
const ci = process.env.GITHUB_ACTIONS === 'true';
if (bootstrap && ci)
  throw new Error('Local bootstrap publication is forbidden in CI.');
if (!bootstrap && !verifyOnly && !ci)
  throw new Error(
    'Trusted publication must run in GitHub Actions. Use release:bootstrap for initial local publication.',
  );
const release = checkRelease();
const prepared = readPreparedRelease(release);
await publishReleaseSet({
  artifacts: prepared.artifacts,
  requireProvenance: ci,
  verifyOnly,
  availability: {
    timeoutMs: 20 * 60_000,
    onPending: (names) =>
      console.log(
        'Waiting for npm processing: ' +
          names.join(', ') +
          '. Checking again in 30 seconds; no uploads are retried.',
      ),
  },
  lookup: (artifact, selector = artifact.version) =>
    readRegistryVersion(artifact.name, selector),
  publish: (artifact) => {
    // Recheck every saved byte before each mutation, before entering npm, which owns any interactive OTP prompt.
    readPreparedRelease(release);
    runManager([
      'exec',
      'npm',
      'publish',
      join(artifactDirectory(release), artifact.filename),
      '--ignore-scripts',
      '--access',
      'public',
      '--tag',
      'next',
      '--registry',
      registry,
      ...(bootstrap ? [] : ['--provenance']),
    ]);
  },
});
console.log(
  (verifyOnly ? 'Verified' : 'Published and verified') +
    ' exact artifacts for ' +
    release.tag +
    (ci
      ? ' with registry provenance metadata.'
      : verifyOnly
        ? ' (local integrity verification does not require CI provenance).'
        : ' (local bootstrap has no CI provenance).'),
);

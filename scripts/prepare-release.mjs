import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRelease, root } from './check-release.mjs';
import {
  artifactDirectory,
  artifactFilename,
  inspectArtifact,
  integrity,
  readPreparedRelease,
  runManager,
} from './release-artifacts.mjs';
import { validateDependencies } from './release-policy.mjs';

const release = checkRelease();
const directory = artifactDirectory(release);
if (existsSync(directory))
  throw new Error(
    'Prepared release directory already exists. Preserve it for retries; inspect/move it explicitly before rebuilding: ' +
      directory,
  );
runManager(['check']);
mkdirSync(directory, { recursive: true });
const artifacts = [];
const manifests = [];
for (const entry of release.config.packages) {
  const args =
    entry.packageDirectory === entry.publishDirectory
      ? ['pack', '--pack-destination', directory]
      : [
          'exec',
          'npm',
          'pack',
          '--ignore-scripts',
          '--pack-destination',
          directory,
        ];
  runManager(args, join(root, entry.publishDirectory));
  const filename = artifactFilename(entry.packageName, release.version);
  const path = join(directory, filename);
  manifests.push(inspectArtifact(path, entry, release.version));
  artifacts.push({
    name: entry.packageName,
    version: release.version,
    filename,
    integrity: integrity(path),
  });
}
validateDependencies(manifests, release.version);
checkRelease();
writeFileSync(
  join(directory, 'manifest.json'),
  JSON.stringify(
    {
      tag: release.tag,
      version: release.version,
      head: release.head,
      artifacts,
    },
    null,
    2,
  ) + '\n',
);
readPreparedRelease(release);
console.log('Prepared verified release tarballs: ' + directory);

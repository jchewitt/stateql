import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './check-release.mjs';
import {
  validateDependencies,
  validatePackedPackage,
  validatePreparedRelease,
} from './release-policy.mjs';

export const artifactDirectory = (release) =>
  join(root, '.artifacts/release', release.tag);
export const artifactFilename = (name, version) =>
  name.slice(1).replace('/', '-') + '-' + version + '.tgz';
export const integrity = (path) =>
  'sha512-' + createHash('sha512').update(readFileSync(path)).digest('base64');

/** Use the same pnpm-owned npm executable on Windows and POSIX. */
export function runManager(args, cwd = root, capture = false) {
  const manager = process.env.npm_execpath;
  if (!manager) throw new Error('Run release commands using pnpm.');
  return execFileSync(process.execPath, [manager, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
}

export function inspectArtifact(path, entry, version) {
  const tar = (...args) =>
    execFileSync('tar', args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  const manifest = JSON.parse(tar('-xOf', path, 'package/package.json'));
  const members = tar('-tf', path)
    .trim()
    .split(/\r?\n/)
    .filter((name) => !name.endsWith('/'));
  if (members.some((name) => !name.startsWith('package/')))
    throw new Error('Tarball contains files outside package/.');
  const files = members.map((name) => name.slice('package/'.length));
  validatePackedPackage({ manifest, files, entry, version });
  return manifest;
}

export function readPreparedRelease(release) {
  const directory = artifactDirectory(release);
  const prepared = JSON.parse(
    readFileSync(join(directory, 'manifest.json'), 'utf8'),
  );
  validatePreparedRelease(prepared, release);
  const manifests = prepared.artifacts.map((artifact, index) => {
    const path = join(directory, artifact.filename);
    if (integrity(path) !== artifact.integrity)
      throw new Error(
        'Prepared tarball integrity changed: ' + artifact.filename,
      );
    return inspectArtifact(
      path,
      release.config.packages[index],
      release.version,
    );
  });
  validateDependencies(manifests, release.version);
  return prepared;
}

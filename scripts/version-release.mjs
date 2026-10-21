import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { validateRelease } from './release-policy.mjs';

const manager = process.env.npm_execpath;
if (!manager) throw new Error('Run through pnpm version:release.');
const run = (...args) =>
  execFileSync(process.execPath, [manager, ...args], { stdio: 'inherit' });
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const config = json('release.config.json');
const before = json('packages/core/package.json').version;
run('changeset', 'version');
const manifests = config.packages.map((entry) =>
  json(entry.packageDirectory + '/package.json'),
);
const version = manifests[0].version;
validateRelease({ config, manifests, tag: 'tandrove-v' + version });
if (version === before)
  throw new Error(
    'No new version was generated; release PR creation requires pending Changesets.',
  );
// Keep installation examples aligned with the generated manifests.
for (const path of [
  'README.md',
  'docs/ANGULAR.md',
  ...config.packages.map((entry) => entry.packageDirectory + '/README.md'),
])
  writeFileSync(path, readFileSync(path, 'utf8').replaceAll(before, version));
run('install', '--lockfile-only');
run(
  'exec',
  'prettier',
  '--write',
  '.changeset/pre.json',
  'pnpm-lock.yaml',
  'README.md',
  'docs/ANGULAR.md',
  ...config.packages.flatMap((entry) =>
    ['package.json', 'CHANGELOG.md', 'README.md'].map(
      (file) => entry.packageDirectory + '/' + file,
    ),
  ),
);

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  validateRelease,
  validateWorkflowRevision,
} from './release-policy.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const readJson = (path) =>
  JSON.parse(readFileSync(resolve(root, path), 'utf8'));
export const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

export function checkRelease() {
  const config = readJson('release.config.json');
  const manifests = config.packages.map((entry) =>
    readJson(entry.packageDirectory + '/package.json'),
  );
  const result = validateRelease({
    manifests,
    config,
    tag: process.env.RELEASE_TAG,
  });
  const head = git('rev-parse', 'HEAD');
  if (head !== git('rev-parse', result.tag + '^{commit}'))
    throw new Error('Check out the exact release tag before publishing.');
  git('merge-base', '--is-ancestor', 'HEAD', 'origin/main');
  if (process.env.GITHUB_ACTIONS === 'true')
    validateWorkflowRevision({ head, workflowSha: process.env.GITHUB_SHA });
  if (git('status', '--porcelain'))
    throw new Error('Release checkout must be clean.');
  return { ...result, head, config };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = checkRelease();
  console.log('Release preflight passed: ' + result.tag + ' at ' + result.head);
}

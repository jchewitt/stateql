import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  validateRelease,
  validateWorkflowRevision,
} from './release-policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = (path) =>
  JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const config = readJson('release.config.json');
const manifest = readJson(`${config.packageDirectory}/package.json`);
const result = validateRelease({
  manifest,
  config,
  tag: process.env.RELEASE_TAG,
});
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('rev-parse', 'HEAD') !== git('rev-parse', `${result.tag}^{commit}`))
  throw new Error('Check out the exact release tag before publishing.');
git('merge-base', '--is-ancestor', 'HEAD', 'origin/main');
if (process.env.GITHUB_ACTIONS === 'true')
  validateWorkflowRevision({
    head: git('rev-parse', 'HEAD'),
    workflowSha: process.env.GITHUB_SHA,
  });
if (git('status', '--porcelain'))
  throw new Error('Release checkout must be clean.');
console.log(`Release preflight passed: ${manifest.name}@${result.version}`);

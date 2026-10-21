import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { planPublication } from './publication-plan.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const api = (path, body) =>
  JSON.parse(
    execFileSync(
      'gh',
      ['api', path, ...(body ? ['--method', 'POST', '--input', '-'] : [])],
      { encoding: 'utf8', ...(body ? { input: JSON.stringify(body) } : {}) },
    ),
  );
const pages = (path) =>
  JSON.parse(
    execFileSync('gh', ['api', '--paginate', '--slurp', path], {
      encoding: 'utf8',
    }),
  );
const output = (value) =>
  appendFileSync(process.env.GITHUB_OUTPUT, value + '\n');
const config = JSON.parse(readFileSync('release.config.json', 'utf8'));
const manifests = config.packages.map((entry) =>
  JSON.parse(readFileSync(entry.packageDirectory + '/package.json', 'utf8')),
);
const result = planPublication({
  sha: git('rev-parse', 'HEAD'),
  repository: process.env.GITHUB_REPOSITORY,
  ref: process.env.GITHUB_REF,
  workflowSha: process.env.GITHUB_SHA,
  eventName: process.env.GITHUB_EVENT_NAME,
  requestedTag: process.env.REQUESTED_RELEASE_TAG,
  config,
  manifests,
  api,
  pages,
  readPrevious: () =>
    config.packages.map(
      (entry) =>
        JSON.parse(
          git('show', 'HEAD^:' + entry.packageDirectory + '/package.json'),
        ).version,
    ),
  resolveTag: (tag) => git('rev-parse', tag + '^{commit}'),
});
for (const [name, value] of Object.entries(result)) output(name + '=' + value);
console.log(
  result.publish
    ? 'Reviewed publication planned: ' + result.release_tag
    : 'No package version change; no publication.',
);

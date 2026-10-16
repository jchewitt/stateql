import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const json = (path) => JSON.parse(read(path));

test('root is private and the runtime foundation has no framework or platform dependencies', () => {
  assert.equal(json('package.json').private, true);
  const manifest = json('packages/core/package.json');
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.deepEqual(manifest.peerDependencies ?? {}, {});
  const compiler = json('tsconfig.base.json').compilerOptions;
  assert.deepEqual(compiler.lib, ['ES2022']);
  assert.deepEqual(compiler.types, []);
});

test('published entrypoints match the declaration build and explicit package allowlist', () => {
  const manifest = json('packages/core/package.json');
  assert.equal(manifest.exports['.'].types, './dist/index.d.ts');
  assert.equal(manifest.exports['.'].import, './dist/index.js');
  assert.deepEqual(manifest.files, ['dist', 'README.md', 'LICENSE']);
  assert.equal(manifest.license, 'MIT');
  assert.equal(
    manifest.repository.url,
    'git+https://github.com/jchewitt/stateql.git',
  );
});

test('workflows parse, pin actions, and never run privileged pull-request code', () => {
  for (const name of readdirSync(new URL('.github/workflows/', root))) {
    const workflow = parse(read(`.github/workflows/${name}`));
    assert.ok(workflow.on);
    assert.equal(workflow.on.pull_request_target, undefined);
    assert.equal(workflow.permissions.contents, 'read');
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses) assert.match(step.uses, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
      }
    }
  }
});

test('publishing is manual and restricted to the main workflow and npm environment', () => {
  const release = parse(read('.github/workflows/publish.yml'));
  assert.deepEqual(Object.keys(release.on), ['workflow_dispatch']);
  assert.equal(release.jobs.publish.if, "github.ref == 'refs/heads/main'");
  assert.equal(release.jobs.publish.environment, 'npm');
  assert.equal(release.jobs.publish.permissions['id-token'], 'write');
  assert.equal(typeof json('release.config.json').ready, 'boolean');
});

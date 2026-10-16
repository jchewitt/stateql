import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateRelease,
  validateWorkflowRevision,
} from '../scripts/release-policy.mjs';

test('provenance revision must match the code being published', () => {
  assert.doesNotThrow(() =>
    validateWorkflowRevision({ head: 'same', workflowSha: 'same' }),
  );
  assert.throws(() =>
    validateWorkflowRevision({ head: 'older-tag', workflowSha: 'main' }),
  );
  assert.throws(() =>
    validateWorkflowRevision({ head: 'tag', workflowSha: undefined }),
  );
});

function candidate() {
  return {
    manifest: {
      name: '@jchewitt/stateql-core',
      version: '0.1.0-alpha.0',
      publishConfig: {
        tag: 'next',
        access: 'public',
        registry: 'https://registry.npmjs.org/',
      },
    },
    config: {
      ready: true,
      packageName: '@jchewitt/stateql-core',
      distTag: 'next',
    },
    tag: 'core-v0.1.0-alpha.0',
  };
}

test('accepts an explicitly enabled experimental release with a matching tag', () => {
  assert.equal(validateRelease(candidate()).version, '0.1.0-alpha.0');
});

for (const [name, change] of [
  ['unready scaffold', (c) => (c.config.ready = false)],
  ['private package', (c) => (c.manifest.private = true)],
  ['different package', (c) => (c.manifest.name = 'other')],
  ['bootstrap version', (c) => (c.manifest.version = '0.0.0')],
  ['stable release', (c) => (c.manifest.version = '1.0.0')],
  ['invalid semver', (c) => (c.manifest.version = '0.1.0-alpha.01')],
  ['mismatched tag', (c) => (c.tag = 'core-v0.2.0-alpha.0')],
  ['missing tag', (c) => (c.tag = undefined)],
  ['latest distribution tag', (c) => (c.config.distTag = 'latest')],
  [
    'private registry',
    (c) => (c.manifest.publishConfig.registry = 'https://example.org/'),
  ],
]) {
  test(`rejects ${name}`, () => {
    const value = candidate();
    change(value);
    assert.throws(() => validateRelease(value));
  });
}

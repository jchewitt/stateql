import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import { planPublication } from '../scripts/publication-plan.mjs';
import {
  requiredChecks,
  validateReviewedRelease,
} from '../scripts/release-automation-policy.mjs';

function candidate() {
  const repository = 'jchewitt/tandrove';
  return {
    repository,
    sha: 'merged',
    pr: {
      merged: true,
      merge_commit_sha: 'merged',
      merged_at: '2026-10-21T12:00:00Z',
      base: { ref: 'main', repo: { full_name: repository } },
      head: {
        ref: 'changeset-release/main',
        sha: 'reviewed',
        repo: { full_name: repository },
      },
      user: { login: 'github-actions[bot]' },
    },
    reviews: [
      {
        id: 1,
        user: { login: 'maintainer', type: 'User' },
        author_association: 'OWNER',
        state: 'APPROVED',
        commit_id: 'reviewed',
        submitted_at: '2026-10-21T11:00:00Z',
      },
    ],
    checks: requiredChecks.map((name, id) => ({
      name,
      id,
      head_sha: 'reviewed',
      app: { slug: 'github-actions' },
      status: 'completed',
      conclusion: 'success',
    })),
    files: [
      { filename: 'packages/core/package.json' },
      { filename: 'pnpm-lock.yaml' },
    ],
  };
}

function planner() {
  const evidence = candidate();
  evidence.pr.number = 42;
  const json = (path) =>
    JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
  const config = json('release.config.json');
  const manifests = config.packages.map((entry) =>
    json(entry.packageDirectory + '/package.json'),
  );
  const version = '0.1.0-alpha.2';
  for (const manifest of manifests) {
    manifest.version = version;
    if (manifest.peerDependencies?.['@tandrove/core'])
      manifest.peerDependencies['@tandrove/core'] = version;
  }
  const calls = [];
  const writes = [];
  const state = { refs: [], target: { type: 'commit', sha: 'merged' } };
  const options = {
    ...evidence,
    config,
    manifests,
    workflowSha: 'merged',
    ref: 'refs/heads/main',
    eventName: 'push',
    requestedTag: 'tandrove-v' + version,
    readPrevious: () => manifests.map(() => '0.1.0-alpha.1'),
    resolveTag: () => 'merged',
    pages(path) {
      calls.push(path);
      if (path.includes('/check-runs?'))
        return [{ check_runs: evidence.checks }];
      if (path.includes('/reviews?')) return [evidence.reviews];
      if (path.includes('/files?')) return [evidence.files];
      if (path.includes('/pulls?')) return [[evidence.pr]];
      throw new Error('Unexpected API page: ' + path);
    },
    api(path, body) {
      calls.push(path);
      if (body) {
        writes.push({ path, body });
        return { sha: 'tag-object' };
      }
      if (path.endsWith('/pulls/42')) return evidence.pr;
      if (path.includes('/matching-refs/')) return state.refs;
      if (path.endsWith('/git/tags/tag-object'))
        return { object: state.target };
      throw new Error('Unexpected API read: ' + path);
    },
  };
  return { options, evidence, calls, writes, state };
}

test('ordinary version-unchanged merge makes no GitHub calls or tag writes', () => {
  const v = planner();
  v.options.readPrevious = () =>
    v.options.manifests.map((manifest) => manifest.version);
  assert.deepEqual(planPublication(v.options), { publish: false });
  assert.deepEqual(v.calls, []);
});

test('review rejection occurs before any tag write', () => {
  const v = planner();
  v.evidence.reviews.length = 0;
  assert.throws(() => planPublication(v.options), /maintainer approval/);
  assert.deepEqual(v.writes, []);
});

test('approved release creates an annotated tag at the workflow merge commit', () => {
  const v = planner();
  assert.deepEqual(planPublication(v.options), {
    publish: true,
    release_tag: 'tandrove-v0.1.0-alpha.2',
  });
  assert.deepEqual(v.writes, [
    {
      path: 'repos/jchewitt/tandrove/git/tags',
      body: {
        tag: 'tandrove-v0.1.0-alpha.2',
        message: 'Tandrove 0.1.0-alpha.2; reviewed release PR #42',
        object: 'merged',
        type: 'commit',
      },
    },
    {
      path: 'repos/jchewitt/tandrove/git/refs',
      body: { ref: 'refs/tags/tandrove-v0.1.0-alpha.2', sha: 'tag-object' },
    },
  ]);
});

test('matching annotated tag is reused without writes; mismatched or lightweight tags are rejected', () => {
  const v = planner();
  v.state.refs = [
    {
      ref: 'refs/tags/tandrove-v0.1.0-alpha.2',
      object: { type: 'tag', sha: 'tag-object' },
    },
  ];
  assert.equal(planPublication(v.options).publish, true);
  assert.deepEqual(v.writes, []);
  v.state.target.sha = 'different';
  assert.throws(() => planPublication(v.options), /never moved/);
  v.state.refs[0].object = { type: 'commit', sha: 'merged' };
  assert.throws(() => planPublication(v.options), /never moved/);
  assert.deepEqual(v.writes, []);
});

test('manual recovery requires an existing version-matching tag at the workflow commit and never creates tags', () => {
  const v = planner();
  v.options.eventName = 'workflow_dispatch';
  assert.equal(planPublication(v.options).publish, true);
  assert.deepEqual(v.calls, []);
  v.options.resolveTag = () => 'different';
  assert.throws(() => planPublication(v.options), /already point/);
  v.options.requestedTag = 'wrong';
  assert.throws(() => planPublication(v.options), /does not match/);
  assert.deepEqual(v.writes, []);
});

for (const [name, change] of Object.entries({
  'wrong workflow SHA': (v) => {
    v.options.workflowSha = 'other';
  },
  'wrong repository': (v) => {
    v.options.repository = 'other/tandrove';
  },
  'non-main execution': (v) => {
    v.options.ref = 'refs/heads/feature';
  },
  downgrade: (v) => {
    v.options.readPrevious = () => Array(3).fill('0.1.0-alpha.3');
  },
  'missing previous manifests': (v) => {
    v.options.readPrevious = () => [];
  },
  'missing bot PR': (v) => {
    v.evidence.pr.head.ref = 'feature';
  },
}))
  test(`planner refuses ${name} without writes`, () => {
    const v = planner();
    change(v);
    assert.throws(() => planPublication(v.options));
    assert.deepEqual(v.writes, []);
  });

test('accepts a reviewed bot release with all required CI checks at its head', () => {
  assert.doesNotThrow(() => validateReviewedRelease(candidate()));
});

for (const [name, change] of Object.entries({
  'unmerged PR': (v) => {
    v.pr.merged = false;
  },
  'different merge commit': (v) => {
    v.pr.merge_commit_sha = 'other';
  },
  'ordinary branch': (v) => {
    v.pr.head.ref = 'feature';
  },
  'fork branch': (v) => {
    v.pr.head.repo.full_name = 'other/tandrove';
  },
  'non-bot author': (v) => {
    v.pr.user.login = 'maintainer';
  },
  'runtime changes': (v) => {
    v.files.push({ filename: 'packages/core/src/index.ts' });
  },
  'workflow changes': (v) => {
    v.files.push({ filename: '.github/workflows/publish.yml' });
  },
  'no file evidence': (v) => {
    v.files = [];
  },
  'missing approval': (v) => {
    v.reviews = [];
  },
  'stale approval': (v) => {
    v.reviews[0].commit_id = 'old';
  },
  'bot approval': (v) => {
    v.reviews[0].user.type = 'Bot';
  },
  'outsider approval': (v) => {
    v.reviews[0].author_association = 'CONTRIBUTOR';
  },
  'approval after merge': (v) => {
    v.reviews[0].submitted_at = '2026-10-21T13:00:00Z';
  },
  'dismissed approval': (v) => {
    v.reviews.push({ ...v.reviews[0], id: 2, state: 'DISMISSED' });
  },
  'unresolved change request': (v) => {
    v.reviews.push({
      ...v.reviews[0],
      id: 2,
      user: { login: 'other-maintainer', type: 'User' },
      state: 'CHANGES_REQUESTED',
    });
  },
  'missing CI check': (v) => {
    v.checks.pop();
  },
  'failed CI check': (v) => {
    v.checks[0].conclusion = 'failure';
  },
  'stale CI check': (v) => {
    v.checks[0].head_sha = 'old';
  },
  'untrusted CI app': (v) => {
    v.checks[0].app.slug = 'other';
  },
  'newer failed rerun': (v) => {
    v.checks.push({ ...v.checks[0], id: 99, conclusion: 'failure' });
  },
}))
  test(`blocks ${name}`, () => {
    const value = candidate();
    change(value);
    assert.throws(() => validateReviewedRelease(value));
  });

test('uses the latest substantive review regardless of pagination order', () => {
  const value = candidate();
  value.reviews.unshift({ ...value.reviews[0], id: 2 });
  value.reviews[1].state = 'CHANGES_REQUESTED';
  value.reviews.push({ ...value.reviews[0], id: 3, state: 'COMMENTED' });
  assert.doesNotThrow(() => validateReviewedRelease(value));
});

test('bot PR dispatches CI explicitly and leaves publication to the existing trusted workflow', () => {
  const read = (path) =>
    parse(
      readFileSync(
        new URL('../.github/workflows/' + path, import.meta.url),
        'utf8',
      ),
    );
  const bot = read('release-pr.yml');
  const ci = read('ci.yml');
  const publish = read('publish.yml');
  assert.ok(Object.hasOwn(ci.on, 'workflow_dispatch'));
  const steps = bot.jobs.version.steps;
  const action = steps.find((step) =>
    step.uses?.startsWith('changesets/action@'),
  );
  assert.equal(action.with.version, 'pnpm version:release');
  assert.equal(action.with.publish, undefined);
  assert.ok(steps.some((step) => step.run?.includes('gh workflow run ci.yml')));
  assert.equal(bot.jobs.version.permissions.actions, 'write');
  assert.equal(publish.jobs.publish.environment, 'npm');
  assert.equal(publish.jobs.publish.permissions['id-token'], 'write');
  const checkout = publish.jobs.publish.steps.find((step) =>
    step.uses?.startsWith('actions/checkout@'),
  );
  assert.equal(checkout.with.ref, '${{ github.sha }}');
});

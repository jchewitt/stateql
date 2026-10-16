import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = join(root, '.artifacts', randomUUID());
mkdirSync(artifacts, { recursive: true });
const manager = process.env.npm_execpath;
assert.ok(manager, 'Run this check using pnpm pack:check.');
const npm = (args, cwd) =>
  execFileSync(process.execPath, [manager, 'exec', 'npm', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

// A removed source must never leave an obsolete file in the shipping payload.
const output = join(root, 'packages/core/dist');
mkdirSync(output, { recursive: true });
writeFileSync(
  join(output, '__stale-build-probe.js'),
  'export const obsolete = true;\n',
);
const [packed] = JSON.parse(
  npm(
    ['pack', '--json', '--pack-destination', artifacts],
    join(root, 'packages/core'),
  ),
);
const files = packed.files.map(({ path }) => path);
for (const expected of [
  'dist/index.js',
  'dist/index.d.ts',
  'LICENSE',
  'README.md',
])
  assert.ok(files.includes(expected), `Missing package file: ${expected}`);
assert.ok(
  !files.includes('dist/__stale-build-probe.js'),
  'Build must remove stale outputs.',
);
assert.ok(
  files.every((path) =>
    /^(dist\/|package\.json$|README\.md$|LICENSE$)/.test(path),
  ),
);
assert.equal(
  readFileSync(join(root, 'LICENSE'), 'utf8'),
  readFileSync(join(root, 'packages/core/LICENSE'), 'utf8'),
);

// Outside the repository so Node/TypeScript cannot resolve undeclared workspace dependencies.
const tempRoot = realpathSync(tmpdir());
const consumer = realpathSync(mkdtempSync(join(tempRoot, 'stateql-consumer-')));
try {
  const relativeConsumer = relative(root, consumer);
  assert.ok(
    relativeConsumer.startsWith('..') || isAbsolute(relativeConsumer),
    'Consumer must be outside the repository.',
  );
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  npm(
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      join(artifacts, packed.filename),
    ],
    consumer,
  );
  execFileSync(
    process.execPath,
    ['--input-type=module', '-e', "await import('@jchewitt/stateql-core')"],
    {
      cwd: consumer,
      stdio: 'inherit',
    },
  );
  writeFileSync(
    join(consumer, 'consumer.ts'),
    "import type { StoreReader } from '@jchewitt/stateql-core';\n" +
      'declare const reader: StoreReader<Readonly<{ id: string }>>;\n' +
      'const id: string = reader.getSnapshot().id;\nvoid id;\n' +
      '// @ts-expect-error undeclared fields must not be inferred as any\nreader.getSnapshot().missing;\n',
  );
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--strict',
      '--noEmit',
      '--module',
      'NodeNext',
      '--target',
      'ES2022',
      'consumer.ts',
    ],
    {
      cwd: consumer,
      stdio: 'inherit',
    },
  );
  console.log(
    `Packed artifact and isolated ESM/TypeScript consumer passed: ${packed.filename}`,
  );
} finally {
  // Delete only this exact generated temporary directory, never an unchecked path.
  assert.equal(dirname(consumer), tempRoot);
  assert.ok(basename(consumer).startsWith('stateql-consumer-'));
  rmSync(consumer, { recursive: true, force: true });
}

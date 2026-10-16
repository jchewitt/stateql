import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const packageRoot = realpathSync(join(root, 'packages/core'));
const within = relative(root, packageRoot);
assert.ok(
  within && !within.startsWith('..') && !isAbsolute(within),
  'Package must be within the repository.',
);
// Exact fixed output target, resolved inside the verified package directory.
const output = join(packageRoot, 'dist');
assert.equal(relative(packageRoot, output), 'dist');
rmSync(output, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [join(root, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json'],
  {
    cwd: packageRoot,
    stdio: 'inherit',
  },
);

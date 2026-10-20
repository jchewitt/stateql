import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(
  new URL('../packages/angular/', import.meta.url),
);
const require = createRequire(join(packageRoot, 'package.json'));
const packagrRoot = dirname(require.resolve('ng-packagr/package.json'));
execFileSync(
  process.execPath,
  [
    join(packagrRoot, 'src/cli/main.js'),
    '-p',
    'ng-package.json',
    '-c',
    'tsconfig.lib.json',
  ],
  { cwd: packageRoot, stdio: 'inherit' },
);

// Source-workspace entrypoints include dist/. The APF package is packed FROM dist,
// where ng-packagr's generated export map/typings are the authoritative paths.
const manifestPath = join(packageRoot, 'dist/package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
delete manifest.main;
delete manifest.types;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

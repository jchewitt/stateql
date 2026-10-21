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

export function checkAngularPackage({
  root,
  artifacts,
  coreTarball,
  npm,
  registry = false,
}) {
  const output = join(root, 'packages/angular/dist');
  mkdirSync(output, { recursive: true });
  writeFileSync(
    join(output, '__stale-build-probe.js'),
    'export const obsolete = true;\n',
  );
  execFileSync(process.execPath, [join(root, 'scripts/build-angular.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  const [packed] = JSON.parse(
    npm(
      ['pack', '--ignore-scripts', '--json', '--pack-destination', artifacts],
      output,
    ),
  );
  const files = packed.files.map(({ path }) => path);
  for (const file of [
    'fesm2022/tandrove-angular.mjs',
    'types/tandrove-angular.d.ts',
    'package.json',
    'LICENSE',
    'README.md',
  ])
    assert.ok(files.includes(file), `Missing Angular package file: ${file}`);
  assert.ok(
    files.every((file) =>
      /^(fesm2022\/|types\/|package\.json$|LICENSE$|README\.md$)/.test(file),
    ),
  );
  const manifest = JSON.parse(
    readFileSync(join(output, 'package.json'), 'utf8'),
  );
  assert.notEqual(manifest.private, true);
  assert.equal(manifest.sideEffects, false);
  assert.equal(manifest.exports['.'].types, './types/tandrove-angular.d.ts');
  assert.equal(
    manifest.exports['.'].default,
    './fesm2022/tandrove-angular.mjs',
  );
  assert.equal(manifest.typings, 'types/tandrove-angular.d.ts');
  assert.equal(manifest.module, 'fesm2022/tandrove-angular.mjs');
  assert.equal(manifest.main, undefined);
  assert.equal(manifest.types, undefined);
  assert.equal(manifest.dependencies['@tandrove/core'], undefined);
  assert.equal(
    manifest.peerDependencies['@tandrove/core'],
    JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8'))
      .version,
  );
  assert.equal(manifest.peerDependencies['@angular/core'], '^21.2.25');
  assert.equal(
    readFileSync(join(output, 'LICENSE'), 'utf8'),
    readFileSync(join(root, 'LICENSE'), 'utf8'),
  );

  const tempRoot = realpathSync(tmpdir());
  const consumer = realpathSync(
    mkdtempSync(join(tempRoot, 'tandrove-angular-consumer-')),
  );
  try {
    const outside = relative(root, consumer);
    assert.ok(outside.startsWith('..') || isAbsolute(outside));
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
        '--registry=https://registry.npmjs.org/',
        registry ? `@tandrove/core@${manifest.version}` : coreTarball,
        registry
          ? `@tandrove/angular@${manifest.version}`
          : join(artifacts, packed.filename),
        '@angular/core@21.2.25',
        '@angular/compiler@21.2.25',
        '@angular/compiler-cli@21.2.25',
        '@angular/common@21.2.25',
        '@angular/platform-browser@21.2.25',
        '@angular/platform-browser-dynamic@21.2.25',
        '@angular/platform-server@21.2.25',
        'rxjs@7.8.2',
        'tslib@2.8.1',
        'typescript@5.9.3',
      ],
      consumer,
    );
    const installed = JSON.parse(
      readFileSync(
        join(consumer, 'node_modules/@tandrove/angular/package.json'),
        'utf8',
      ),
    );
    assert.equal(installed.name, '@tandrove/angular');
    assert.equal(installed.version, manifest.version);
    assert.deepEqual(installed.exports, manifest.exports);
    assert.deepEqual(installed.peerDependencies, manifest.peerDependencies);
    const installedCore = JSON.parse(
      readFileSync(
        join(consumer, 'node_modules/@tandrove/core/package.json'),
        'utf8',
      ),
    );
    assert.equal(installedCore.name, '@tandrove/core');
    assert.equal(installedCore.version, manifest.version);
    const fixtureRoot = join(root, 'tests/fixtures/angular-consumer');
    for (const file of [
      'consumer.mjs',
      'owned-query.mjs',
      'consumer.ts',
      'tsconfig.json',
    ])
      writeFileSync(
        join(consumer, file),
        readFileSync(join(fixtureRoot, file)),
      );
    execFileSync(process.execPath, [join(consumer, 'consumer.mjs')], {
      cwd: consumer,
      stdio: 'inherit',
    });
    execFileSync(process.execPath, [join(consumer, 'owned-query.mjs')], {
      cwd: consumer,
      stdio: 'inherit',
    });
    execFileSync(
      process.execPath,
      [
        join(
          consumer,
          'node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js',
        ),
        '-p',
        'tsconfig.json',
      ],
      { cwd: consumer, stdio: 'inherit' },
    );
    assert.match(
      readFileSync(join(consumer, 'dist/consumer.js'), 'utf8'),
      /ɵɵdefineComponent/,
    );
    console.log(
      `${registry ? 'Public registry' : 'Tarball'} Angular APF, native ESM observation and AOT template consumer passed: @tandrove/angular ${manifest.version}`,
    );
  } finally {
    assert.equal(dirname(consumer), tempRoot);
    assert.ok(basename(consumer).startsWith('tandrove-angular-consumer-'));
    rmSync(consumer, { recursive: true, force: true });
  }
}

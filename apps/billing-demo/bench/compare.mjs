import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { build, version as esbuildVersion } from 'esbuild';
import ts from 'typescript';
import { print } from 'graphql';
import { createSchema } from '@jchewitt/stateql-graphql';
import { schemaSource } from '../../billing-api/src/schema.js';
import { BILLING_INVOICES, INVOICE_ACCOUNTS } from '../src/data/operations.js';
import { createBillingCache } from '../src/data/cache.js';
import {
  billingInvoices,
  billingScope,
} from '../src/data/stateql-definitions.js';
import { compareNetwork } from './network.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = join(root, '.artifacts/comparison');
mkdirSync(output, { recursive: true });
const app = 'apps/billing-demo/src/';
const read = (path) =>
  readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n');
const size = (text) => ({
  nonblankLines: text.split('\n').filter((line) => line.trim()).length,
  utf8Bytes: Buffer.byteLength(text),
});
function declarations(file, names, membersOnly = false) {
  const source = ts.createSourceFile(
    file,
    read(file),
    ts.ScriptTarget.Latest,
    true,
  );
  const found = source.statements.filter((node) => {
    if (ts.isVariableStatement(node))
      return node.declarationList.declarations.some((declaration) =>
        names.includes(declaration.name.getText(source)),
      );
    return node.name && names.includes(node.name.getText(source));
  });
  assert.equal(
    found.length,
    names.length,
    `Missing measurement declarations in ${file}`,
  );
  return {
    file,
    names,
    ...size(
      found
        .map((node) =>
          membersOnly
            ? node.members.map((member) => member.getText(source)).join('\n')
            : node.getText(source),
        )
        .join('\n'),
    ),
  };
}
const declarationsByCategory = {
  apolloReadDocuments: declarations(app + 'data/operations.ts', [
    'INVOICE_IDENTITY',
    'INVOICE_DETAILS',
    'BILLING_INVOICES',
    'INVOICE_ACCOUNTS',
  ]),
  apolloResponseTypes: declarations(app + 'data/operations.ts', [
    'BillingVariables',
    'Invoice',
    'BillingResult',
    'AccountInvoice',
    'AccountResult',
  ]),
  stateqlSelections: declarations(app + 'data/stateql-definitions.ts', [
    'billingInvoices',
    'accountMonitor',
  ]),
  apolloReadPanelMembers: declarations(
    app + 'invoice-panel.ts',
    ['InvoicePanel'],
    true,
  ),
  stateqlReadPanelMembers: declarations(
    app + 'stateql-panel.ts',
    ['StateQLPanel'],
    true,
  ),
  apolloFormsBinding: declarations(app + 'forms/sources.ts', [
    'apolloEditorSource',
  ]),
  stateqlFormsBinding: declarations(app + 'forms/sources.ts', [
    'stateqlEditorSource',
    'stateField',
  ]),
};
const sourceFiles = Object.fromEntries(
  [
    app + 'data/generated/billing.ts',
    'scripts/generate-billing.ts',
    app + 'data/cache.ts',
    app + 'stateql-client.ts',
    app + 'billing.service.ts',
    app + 'main.ts',
    ...[
      'draft.ts',
      'save-account.ts',
      'invoice-editor.ts',
      'invoice-editor.html',
      'billing-editors.ts',
    ].map((file) => app + 'forms/' + file),
  ].map((file) => [file, size(read(file))]),
);

// These are deliberately small library-consumer bundles, not the dual-client demo.
const bundles = [];
for (const entry of [
  'apollo',
  'stateql',
  'apollo-angular',
  'stateql-angular',
]) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [`apps/billing-demo/bench/entries/${entry}.ts`],
    bundle: true,
    minify: true,
    write: false,
    metafile: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    legalComments: 'none',
    sourcemap: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    // Shared Angular framework is excluded; GraphQL, RxJS and other dependencies are included.
    external: ['@angular/*'],
  });
  assert.equal(result.outputFiles.length, 1);
  const bytes = result.outputFiles[0].contents;
  writeFileSync(join(output, `${entry}.js`), bytes);
  writeFileSync(
    join(output, `${entry}.meta.json`),
    JSON.stringify(result.metafile, null, 2),
  );
  bundles.push({
    entry,
    minifiedBytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 9 }).length,
    externalImports: [
      ...new Set(
        Object.values(result.metafile.outputs).flatMap((value) =>
          value.imports
            .filter((item) => item.external)
            .map((item) => item.path),
        ),
      ),
    ],
  });
}

// Report actual packed library distributions separately from browser dependency cost.
const packages = [];
const manager = process.env.npm_execpath;
assert.ok(manager, 'Run with pnpm compare.');
const packOutput = join(output, 'packs');
mkdirSync(packOutput, { recursive: true });
for (const directory of [
  'packages/core',
  'packages/graphql',
  'packages/angular/dist',
]) {
  const stdout = execFileSync(
    process.execPath,
    [manager, 'pack', '--json', '--pack-destination', packOutput],
    {
      cwd: join(root, directory),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  const start = stdout.search(/^\{/m);
  assert.ok(start >= 0, 'pnpm must return pack metadata');
  const packed = JSON.parse(stdout.slice(start));
  // Stat the packed input files; pnpm's file list does not include byte sizes.
  packages.push({
    directory,
    archiveBytes: statSync(packed.filename).size,
    unpackedSourceBytes: packed.files.reduce(
      (total, file) => total + statSync(join(root, directory, file.path)).size,
      0,
    ),
    files: packed.files.length,
  });
}

// Batch statistics avoid pretending individual sub-millisecond samples are stable.
function measure(name, action) {
  for (let i = 0; i < 100; i++) action();
  const batchMeanMicroseconds = [];
  for (let batch = 0; batch < 9; batch++) {
    const start = performance.now();
    for (let iteration = 0; iteration < 200; iteration++) action();
    batchMeanMicroseconds.push(((performance.now() - start) * 1000) / 200);
  }
  const sorted = [...batchMeanMicroseconds].sort((a, b) => a - b);
  return {
    name,
    warmup: 100,
    batches: 9,
    iterationsPerBatch: 200,
    medianBatchMeanUs: sorted[4],
    minBatchMeanUs: sorted[0],
    maxBatchMeanUs: sorted[8],
    batchMeanMicroseconds,
  };
}
const bound = billingInvoices.bind(
  { billing: { tenantId: 'A' } },
  billingScope,
);
const cache = createBillingCache();
let sink;
const timings = [
  measure('stateql runtime schema initialization', () => {
    sink = createSchema(schemaSource, {
      identities: {
        Billing: ['tenantId'],
        Invoice: ['tenantId', 'id'],
        User: ['tenantId', 'id'],
      },
    });
  }),
  measure('stateql bind definition', () => {
    sink = billingInvoices.bind({ billing: { tenantId: 'A' } }, billingScope);
  }),
  measure(
    'stateql prepare full (construct + validate + print + freeze)',
    () => {
      sink = bound.prepare();
    },
  ),
  measure(
    'stateql prepare accountId (construct + validate + print + freeze)',
    () => {
      sink = bound.prepare('accountId');
    },
  ),
  measure('apollo cached transform + print predeclared full document', () => {
    sink = print(cache.transformDocument(BILLING_INVOICES));
  }),
  measure('apollo cached transform + print predeclared narrow document', () => {
    sink = print(cache.transformDocument(INVOICE_ACCOUNTS));
  }),
];
assert.ok(sink);
const manifest = JSON.parse(read(app + '../package.json'));
const report = {
  formatVersion: 1,
  measuredAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  sourceDirty:
    execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    }).trim().length > 0,
  environment: {
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    esbuild: esbuildVersion,
  },
  versions: {
    apollo: manifest.dependencies['@apollo/client'],
    graphql: manifest.dependencies.graphql,
    angular: manifest.dependencies['@angular/core'],
    apolloAngular: manifest.dependencies['apollo-angular'],
  },
  declarationsByCategory,
  sourceFiles,
  bundles,
  packages,
  timings,
  network: await compareNetwork(),
};
writeFileSync(
  join(output, 'latest.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      report: relative(root, join(output, 'latest.json')),
      bundles,
      packages,
      timings: timings.map(
        ({ name, medianBatchMeanUs, minBatchMeanUs, maxBatchMeanUs }) => ({
          name,
          medianBatchMeanUs,
          minBatchMeanUs,
          maxBatchMeanUs,
        }),
      ),
      network: report.network.map(({ mode, operations }) => ({
        mode,
        operations: operations.length,
        responseBytes: operations.map((operation) => operation.responseBytes),
      })),
    },
    null,
    2,
  ),
);

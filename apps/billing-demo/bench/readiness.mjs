import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, totalmem } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build, version as esbuildVersion } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = join(root, '.artifacts/readiness');
const browserOutput = join(root, 'output/playwright/readiness');
mkdirSync(output, { recursive: true });
mkdirSync(browserOutput, { recursive: true });
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sourceFiles = [
  'apps/billing-demo/bench/readiness.mjs',
  'apps/billing-demo/bench/readiness-node.mjs',
  'apps/billing-demo/bench/readiness-workload.mjs',
];
const report = {
  formatVersion: 1,
  measuredAt: new Date().toISOString(),
  sourceCommit: git('rev-parse', 'HEAD'),
  sourceDirty: git('status', '--porcelain').length > 0,
  harnessSha256: Object.fromEntries(
    sourceFiles.map((file) => [file, sha256(readFileSync(join(root, file)))]),
  ),
  runtimeSourceSha256: sha256(
    git('ls-files', 'packages/core/src', 'packages/graphql/src')
      .split('\n')
      .map((file) => `${file}\0${sha256(readFileSync(join(root, file)))}`)
      .join('\n'),
  ),
  versions: Object.fromEntries(
    ['core', 'graphql'].map((name) => {
      const manifest = JSON.parse(
        readFileSync(join(root, `packages/${name}/package.json`), 'utf8'),
      );
      return [manifest.name, manifest.version];
    }),
  ),
  environment: {
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    systemMemoryBytes: totalmem(),
    esbuild: esbuildVersion,
  },
  limits: [
    'Synthetic supported-schema workloads; not an application trial.',
    'In-process GraphQL execution, decoding, cache commits and projections; no HTTP or Angular rendering.',
    'CPU throttling simulates CPU contention; it is not physical low-powered-device evidence.',
    'Post-GC heap samples cover the whole Chromium isolate, not only Tandrove; they do not prove absence of leaks.',
    'No timing or memory threshold is enforced across different machines.',
  ],
};

console.log('Measuring Node planning and record refresh workloads...');
report.node = JSON.parse(
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL('./readiness-node.mjs', import.meta.url))],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 5 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    },
  ),
);
const bundle = await build({
  stdin: {
    contents:
      "import * as readiness from './readiness-workload.mjs'; globalThis.tandroveReadiness = readiness;",
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
    sourcefile: 'readiness-browser-entry.mjs',
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
  metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});
const browserCode = bundle.outputFiles[0].text;
writeFileSync(join(browserOutput, 'workload.js'), browserCode);
writeFileSync(
  join(browserOutput, 'workload.meta.json'),
  JSON.stringify(bundle.metafile, null, 2) + '\n',
);
report.browserBundleSha256 = sha256(browserCode);
report.browser = [];
const browser = await chromium.launch({ headless: true });
report.environment.chromium = browser.version();
try {
  for (const rate of [1, 4]) {
    console.log(`Measuring Chromium at ${rate}x CPU throttling...`);
    const context = await browser.newContext();
    try {
      await context.route('**/*', (route) => route.abort());
      const page = await context.newPage();
      await page.goto('about:blank');
      await page.addScriptTag({ content: browserCode });
      const session = await context.newCDPSession(page);
      await session.send('Emulation.setCPUThrottlingRate', { rate });
      const profile = await withTimeout(
        measureBrowser(page, session, rate),
        5 * 60 * 1000,
      );
      report.browser.push(profile);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
const path = join(output, 'latest.json');
writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
console.log(`Readiness measurements saved to ${relative(root, path)}.`);

async function measureBrowser(page, session, cpuThrottleRate) {
  const planning = await page.evaluate(() =>
    globalThis.tandroveReadiness.runPlanningMeasurements(),
  );
  const refresh = await page.evaluate(() =>
    globalThis.tandroveReadiness.runRefreshMeasurements({
      recordCounts: [100, 1000],
      samples: 5,
    }),
  );
  // A fresh page excludes planning/refresh fixtures from the lifecycle heap baseline.
  await page.reload();
  await page.addScriptTag({ content: browserCode });
  await page.evaluate(async () => {
    globalThis.lifecycle = globalThis.tandroveReadiness.createLifecycleWorkload(
      {
        recordCount: 1000,
        selectionWidth: 8,
      },
    );
    for (let cycle = 0; cycle < 3; cycle++) {
      await globalThis.lifecycle.acquireBatch({ scopeCount: 3 });
      await globalThis.lifecycle.releaseBatch();
    }
  });
  const heap = [];
  const sample = async (phase, batch) => {
    await session.send('HeapProfiler.collectGarbage');
    const usage = await session.send('Runtime.getHeapUsage');
    const counters = await page.evaluate(() =>
      globalThis.lifecycle.getCounters(),
    );
    heap.push({ phase, batch, ...usage, counters });
  };
  await sample('baseline', 0);
  for (let batch = 1; batch <= 5; batch++) {
    await page.evaluate(() =>
      globalThis.lifecycle.acquireBatch({ scopeCount: 3 }),
    );
    await sample('active', batch);
    await page.evaluate(() => globalThis.lifecycle.releaseBatch());
    await sample('released', batch);
  }
  await page.evaluate(() => globalThis.lifecycle.dispose());
  await sample('disposed', 5);
  return {
    cpuThrottleRate,
    sampling: {
      planning: {
        schemaFieldCounts: [32, 128, 512],
        selectionWidths: [2, 8, 24],
        warmup: 2,
        samples: 5,
      },
      refresh: {
        recordCounts: [100, 1000],
        selectionWidth: 8,
        warmup: 1,
        samples: 5,
        pairedOrder: ['full', 'narrow'],
      },
    },
    planning,
    refresh,
    lifecycle: {
      recordCountPerScope: 1000,
      concurrentScopes: 3,
      warmupBatches: 3,
      measuredBatches: 5,
      retentionMs: 0,
      heap,
    },
  };
}

async function withTimeout(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error('Browser measurement exceeded its five-minute limit.'),
            ),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

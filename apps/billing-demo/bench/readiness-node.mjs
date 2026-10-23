import { pathToFileURL } from 'node:url';
import {
  runPlanningMeasurements,
  runRefreshMeasurements,
} from './readiness-workload.mjs';

export async function runNodeMeasurements() {
  const planningOptions = {
    schemaFieldCounts: [32, 128, 512],
    selectionWidths: [2, 8, 24],
    warmup: 2,
    samples: 5,
  };
  const refreshOptions = {
    recordCounts: [100, 1000, 5000],
    selectionWidth: 8,
    warmup: 1,
    samples: 3,
  };
  return {
    workload: 'synthetic in-process GraphQL client',
    sampling: {
      planning: planningOptions,
      refresh: { ...refreshOptions, pairedOrder: ['full', 'narrow'] },
    },
    timingContract: {
      units: 'milliseconds',
      planning:
        'SDL parsing/inspection, binding and public operation preparation measured separately',
      refresh:
        'wall time includes operation planning, local GraphQL execute, decode/commit and subscriber projections',
      remainder:
        'wall minus local execute; includes scheduling and all client work, not a direct cache-only measurement',
      excluded: [
        'network',
        'JSON serialization',
        'Angular rendering',
        'fixture updates',
        'post-read correctness assertions',
      ],
      statistics:
        'individual samples and min/median/max; no small-sample tail-percentile claims',
    },
    planning: runPlanningMeasurements(planningOptions),
    refresh: await runRefreshMeasurements(refreshOptions),
  };
}

// The parent runner sets a subprocess timeout: synchronous work cannot be
// bounded reliably by a timer executing on this same JavaScript event loop.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await runNodeMeasurements()));

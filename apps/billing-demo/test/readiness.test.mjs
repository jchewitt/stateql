import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  summarizeSamples,
  runPlanningMeasurements,
  runRefreshMeasurements,
  createLifecycleWorkload,
} from '../bench/readiness-workload.mjs';

test('readiness statistics retain observations and compute median without invented percentiles', () => {
  const input = [4, 1, 3, 2];
  const result = summarizeSamples(input);
  assert.deepEqual(result, {
    unit: 'ms',
    samples: input,
    count: 4,
    min: 1,
    median: 2.5,
    max: 4,
  });
  assert.notEqual(result.samples, input);
  assert.deepEqual(input, [4, 1, 3, 2]);
  assert.equal(summarizeSamples([9, 1, 3]).median, 3);
  assert.equal(summarizeSamples([0]).median, 0);
  for (const invalid of [[], [NaN], [Infinity], [-1]])
    assert.throws(() => summarizeSamples(invalid), /finite nonnegative/);
});

test('planning dimensions exercise schema growth and full/narrow preparation with exact sample counts', () => {
  const result = runPlanningMeasurements({
    schemaFieldCounts: [4, 12],
    selectionWidths: [2, 4],
    warmup: 1,
    samples: 2,
  });
  assert.equal(result.length, 2);
  assert.ok(result[1].schemaUtf8Bytes > result[0].schemaUtf8Bytes);
  for (const schema of result) {
    assert.equal(schema.schemaCreation.count, 2);
    assert.equal(schema.selections.length, 2);
    for (const selection of schema.selections)
      for (const metric of [
        selection.bind,
        selection.prepareFull,
        selection.prepareNarrow,
      ]) {
        assert.equal(metric.count, 2);
        assert.ok(
          metric.samples.every((value) => Number.isFinite(value) && value >= 0),
        );
      }
  }
  assert.throws(
    () =>
      runPlanningMeasurements({ schemaFieldCounts: [2], selectionWidths: [4] }),
    /must fit/,
  );
});

test('refresh measurements validate changed fields, cached siblings, peers and membership outside timings', async () => {
  const reports = await runRefreshMeasurements({
    recordCounts: [3, 12],
    selectionWidth: 4,
    warmup: 1,
    samples: 2,
  });
  assert.equal(reports.length, 2);
  for (const report of reports) {
    assert.equal(report.requests, 7); // Initial + two modes × (one warmup + two samples).
    assert.equal(report.consumers, 3);
    assert.ok(
      Object.values(report.correctness).every((value) => value === true),
    );
    for (const mode of [report.full, report.narrow]) {
      assert.equal(mode.wall.count, 2);
      assert.equal(mode.localGraphQLExecute.count, 2);
      assert.equal(mode.nonExecuteRemainder.count, 2);
      for (let index = 0; index < 2; index++) {
        assert.ok(
          mode.wall.samples[index] >= mode.localGraphQLExecute.samples[index],
        );
        assert.ok(mode.nonExecuteRemainder.samples[index] >= 0);
        assert.ok(mode.responseUtf8Bytes[index] > 0);
      }
    }
    assert.ok(
      report.narrow.responseUtf8Bytes[0] < report.full.responseUtf8Bytes[0],
    );
  }
  await assert.rejects(
    runRefreshMeasurements({ recordCounts: [0] }),
    /recordCounts/,
  );
});

test('lifecycle batches release local ownership and reacquire identical scopes after zero-retention eviction', async () => {
  const workload = createLifecycleWorkload({
    recordCount: 5,
    selectionWidth: 3,
  });
  try {
    for (let batch = 0; batch < 3; batch++) {
      const acquired = await workload.acquireBatch({ scopeCount: 2 });
      assert.deepEqual(acquired, {
        scopeCount: 2,
        requestDelta: 2,
        verifiedRecords: 10,
      });
      assert.equal(workload.getCounters().activeOwners, 4);
      assert.equal(workload.getCounters().activeSubscriptions, 4);
      await workload.releaseBatch();
      const counters = workload.getCounters();
      assert.equal(counters.activeOwners, 0);
      assert.equal(counters.activeSubscriptions, 0);
      assert.equal(counters.activeScopes, 0);
      assert.equal(counters.transportInFlight, 0);
      assert.equal(counters.requests, (batch + 1) * 2);
      assert.equal(counters.completedBatches, batch + 1);
    }
    assert.equal(workload.getCounters().verifiedReacquisitions, 4);
  } finally {
    workload.dispose();
  }
  assert.equal(workload.getCounters().disposed, true);
  assert.equal(workload.getCounters().activeOwners, 0);
  await assert.rejects(workload.acquireBatch(), /disposed/);
});

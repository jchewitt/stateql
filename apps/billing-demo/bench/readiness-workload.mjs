import { buildSchema, execute } from 'graphql';
import { createGraphQLClient, createSchema } from '@tandrove/graphql';

// The same fixture runs in Node and a browser. It intentionally includes local
// GraphQL execution, operation planning, decoding, commits and subscriber reads.
// There is no network, Angular rendering, mutation engine or external service.
const scope = { source: 'readiness-synthetic', scope: 'measurement' };

function check(condition, message) {
  if (!condition) throw new Error(`Readiness correctness check: ${message}`);
}

function integer(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(
      `${name} must be an integer from ${minimum} to ${maximum}.`,
    );
  return value;
}

function dimensions(values, name, minimum, maximum) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 16)
    throw new Error(`${name} requires between one and sixteen dimensions.`);
  return values.map((value) => integer(value, name, minimum, maximum));
}

function sampling(warmup, samples) {
  integer(warmup, 'warmup', 0, 20);
  integer(samples, 'samples', 1, 50);
}

/** Individual observations, not percentiles inferred from a small sample. */
export function summarizeSamples(samples) {
  if (
    !Array.isArray(samples) ||
    samples.length === 0 ||
    samples.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error(
      'Samples must be a nonempty array of finite nonnegative milliseconds.',
    );
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    unit: 'ms',
    samples: [...samples],
    count: samples.length,
    min: sorted[0],
    median:
      sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle],
    max: sorted.at(-1),
  };
}

function measureSync(run, validate, warmup, samples) {
  const timings = [];
  for (let iteration = -warmup; iteration < samples; iteration++) {
    const started = performance.now();
    const value = run();
    const elapsed = performance.now() - started;
    validate(value); // Assertions and fixture generation are outside the timer.
    if (iteration >= 0) timings.push(elapsed);
  }
  return summarizeSamples(timings);
}

function schemaSource(fieldCount) {
  return `type Query { items: [Item!]! }
    type Item { id: ID! ${Array.from({ length: fieldCount }, (_, index) => `f${index}: Int!`).join(' ')} }`;
}

function selection(width) {
  return Object.fromEntries(
    Array.from({ length: width }, (_, index) => [`f${index}`, true]),
  );
}

function modelFor(source) {
  return createSchema(source, { identities: { Item: ['id'] } });
}

/** SDL parsing/inspection and repeated public bind/prepare calls, no plan cache. */
export function runPlanningMeasurements({
  schemaFieldCounts = [32, 128, 512],
  selectionWidths = [2, 8, 24],
  warmup = 2,
  samples = 5,
} = {}) {
  const counts = dimensions(schemaFieldCounts, 'schemaFieldCounts', 2, 2048);
  const widths = dimensions(selectionWidths, 'selectionWidths', 2, 128);
  sampling(warmup, samples);
  check(
    Math.max(...widths) <= Math.min(...counts),
    'every selection width must fit every schema dimension',
  );
  return counts.map((schemaFieldCount) => {
    const source = schemaSource(schemaFieldCount);
    const schemaCreation = measureSync(
      () => modelFor(source),
      (model) =>
        check(typeof model.field === 'function', 'schema was constructed'),
      warmup,
      samples,
    );
    const model = modelFor(source);
    return {
      schemaFieldCount,
      schemaUtf8Bytes: new TextEncoder().encode(source).length,
      schemaCreation,
      selections: widths.map((selectionWidth) => {
        const definition = model
          .field('items')
          .select(selection(selectionWidth));
        const bound = definition.bind({}, scope);
        const validateOperation = (operation, width) => {
          check(
            operation.selection.length === width,
            'prepared selection width',
          );
          check(
            operation.query.includes('__typename'),
            'identity context is included',
          );
          check(operation.query.includes('id'), 'record identity is included');
        };
        return {
          selectionWidth,
          bind: measureSync(
            () => definition.bind({}, scope),
            (value) =>
              check(
                value.stateAddress === bound.stateAddress,
                'stable binding address',
              ),
            warmup,
            samples,
          ),
          prepareFull: measureSync(
            () => bound.prepare(),
            (value) => validateOperation(value, selectionWidth),
            warmup,
            samples,
          ),
          prepareNarrow: measureSync(
            () => bound.prepare('f0'),
            (value) => validateOperation(value, 1),
            warmup,
            samples,
          ),
        };
      }),
    };
  });
}

function expectedValue(revision, recordIndex, fieldIndex) {
  return revision * 100_000 + recordIndex * 10 + fieldIndex;
}

function fixture(recordCount, selectionWidth) {
  const source = schemaSource(selectionWidth);
  const executable = buildSchema(source);
  const model = modelFor(source);
  const records = Array.from({ length: recordCount }, (_, index) => ({
    id: String(index),
    ...Object.fromEntries(
      Array.from({ length: selectionWidth }, (_, fieldIndex) => [
        `f${fieldIndex}`,
        expectedValue(0, index, fieldIndex),
      ]),
    ),
  }));
  let revision = 0;
  let requests = 0;
  let transportInFlight = 0;
  let executeMs = 0;
  let response;
  const client = createGraphQLClient({
    retry: false,
    requestPolicy: { retentionMs: 0 },
    transport: async (operation) => {
      requests++;
      transportInFlight++;
      const started = performance.now();
      try {
        const result = execute({
          schema: executable,
          document: operation.document,
          variableValues: operation.variables,
          rootValue: { items: records },
        });
        executeMs += performance.now() - started;
        check(!('then' in result), 'fixture execution must remain synchronous');
        check(!result.errors, 'fixture GraphQL execution must succeed');
        response = result;
        return result;
      } finally {
        transportInFlight--;
      }
    },
  });
  const definition = model.field('items').select(selection(selectionWidth));
  const changed = model.field('items').select({ f0: true });
  const sibling = model.field('items').select({ f1: true });
  return {
    client,
    definition,
    changed,
    sibling,
    advance() {
      revision++;
      records.forEach((record, index) => {
        for (let field = 0; field < selectionWidth; field++)
          record[`f${field}`] = expectedValue(revision, index, field);
      });
      return revision;
    },
    metrics() {
      return { requests, transportInFlight, executeMs };
    },
    responseBytes() {
      return new TextEncoder().encode(JSON.stringify(response)).length;
    },
    clearResponse() {
      response = undefined;
    },
    dispose() {
      client.dispose();
      response = undefined;
      records.length = 0;
    },
  };
}

function verifyRecords(
  snapshot,
  recordCount,
  width,
  revision,
  siblingRevision = revision,
) {
  check(
    snapshot.complete && !snapshot.stale,
    'settled snapshot is complete and fresh',
  );
  check(!snapshot.membershipStale, 'membership remains fresh');
  check(snapshot.records?.length === recordCount, 'record count is preserved');
  snapshot.records.forEach((record, index) => {
    check(
      record.identity.id === String(index),
      'record membership and order are stable',
    );
    for (let field = 0; field < width; field++) {
      const expectedRevision = field === 0 ? revision : siblingRevision;
      check(
        record.data[`f${field}`] ===
          expectedValue(expectedRevision, index, field),
        `record ${index} field f${field} retains its expected revision`,
      );
    }
  });
}

/**
 * Each full/narrow sample changes server fixture values outside its timer.
 * Wall time includes planning, local execute, decode/commit and three subscribed
 * projections. Transport envelope guards are included; JSON byte counting and
 * post-read correctness checks follow the timer.
 */
export async function runRefreshMeasurements({
  recordCounts = [100, 1000, 5000],
  selectionWidth = 8,
  warmup = 1,
  samples = 3,
} = {}) {
  const counts = dimensions(recordCounts, 'recordCounts', 1, 10_000);
  integer(selectionWidth, 'selectionWidth', 2, 32);
  sampling(warmup, samples);
  const reports = [];
  for (const recordCount of counts) {
    const f = fixture(recordCount, selectionWidth);
    const unsubscribes = [];
    try {
      const wide = f.client.watch(f.definition.bind({}, scope));
      await wide.ready;
      const changed = f.client.watch(f.changed.bind({}, scope));
      const sibling = f.client.watch(f.sibling.bind({}, scope));
      await Promise.all([changed.ready, sibling.ready]);
      check(f.metrics().requests === 1, 'peers reuse the initial acquisition');
      check(
        wide.stateAddress === changed.stateAddress &&
          wide.stateAddress === sibling.stateAddress,
        'consumer selections share one state address',
      );
      const notifications = { wide: 0, changed: 0, sibling: 0 };
      for (const [name, handle] of [
        ['wide', wide],
        ['changed', changed],
        ['sibling', sibling],
      ])
        unsubscribes.push(
          handle.subscribe(() => {
            notifications[name]++;
            handle.getSnapshot();
          }),
        );
      const timings = {
        full: { wall: [], execute: [], remainder: [], responseBytes: [] },
        narrow: { wall: [], execute: [], remainder: [], responseBytes: [] },
      };
      let committedRevision = 0;
      for (let iteration = -warmup; iteration < samples; iteration++) {
        // The full pass resets every selected field before testing preservation.
        for (const mode of ['full', 'narrow']) {
          const revision = f.advance();
          const siblingBefore = sibling.getSnapshot();
          const notificationsBefore = { ...notifications };
          const before = f.metrics();
          const started = performance.now();
          await wide.refresh(mode === 'full' ? undefined : 'f0');
          const wall = performance.now() - started;
          const after = f.metrics();
          const localExecute = after.executeMs - before.executeMs;
          check(
            after.requests === before.requests + 1,
            'one operation per refresh',
          );
          check(
            localExecute <= wall,
            'execution is a subset of the measured operation',
          );
          if (mode === 'full') committedRevision = revision;
          verifyRecords(
            wide.getSnapshot(),
            recordCount,
            selectionWidth,
            revision,
            committedRevision,
          );
          verifyRecords(changed.getSnapshot(), recordCount, 1, revision);
          check(
            notifications.wide > notificationsBefore.wide,
            'wide consumer observes changes',
          );
          check(
            notifications.changed > notificationsBefore.changed,
            'shared selected consumer observes changes',
          );
          if (mode === 'narrow') {
            check(
              sibling.getSnapshot() === siblingBefore,
              'unselected sibling snapshot identity is stable',
            );
            check(
              notifications.sibling === notificationsBefore.sibling,
              'unselected sibling receives no notification',
            );
          }
          if (iteration >= 0) {
            timings[mode].wall.push(wall);
            timings[mode].execute.push(localExecute);
            timings[mode].remainder.push(wall - localExecute);
            timings[mode].responseBytes.push(f.responseBytes());
          }
          f.clearResponse();
        }
      }
      const summarize = (measurements) => ({
        wall: summarizeSamples(measurements.wall),
        localGraphQLExecute: summarizeSamples(measurements.execute),
        nonExecuteRemainder: summarizeSamples(measurements.remainder),
        responseUtf8Bytes: measurements.responseBytes,
      });
      reports.push({
        recordCount,
        selectionWidth,
        consumers: 3,
        full: summarize(timings.full),
        narrow: summarize(timings.narrow),
        requests: f.metrics().requests,
        correctness: {
          selectedValues: true,
          preservedSiblings: true,
          sharedConsumers: true,
          stableMembership: true,
          unaffectedSubscriber: true,
        },
      });
    } finally {
      for (const unsubscribe of unsubscribes) unsubscribe();
      f.dispose();
    }
  }
  return reports;
}

/**
 * One long-lived client with zero retention. Reuse the same scope names every
 * batch to verify eviction via absent initial state and a fresh acquisition.
 * The returned controller owns no historical snapshots or large reports.
 */
export function createLifecycleWorkload({
  recordCount = 1000,
  selectionWidth = 8,
} = {}) {
  integer(recordCount, 'recordCount', 1, 10_000);
  integer(selectionWidth, 'selectionWidth', 2, 32);
  const f = fixture(recordCount, selectionWidth);
  const active = [];
  let disposed = false;
  let batchStarts = 0;
  let completedBatches = 0;
  let activeSubscriptions = 0;
  let notifications = 0;
  let verifiedReacquisitions = 0;
  const seenScopes = new Set();
  function release() {
    for (const entry of active) {
      for (const unsubscribe of entry.unsubscribes) {
        unsubscribe();
        activeSubscriptions--;
      }
      for (const handle of entry.handles) handle.dispose();
      entry.handles.length = 0;
      entry.unsubscribes.length = 0;
    }
    if (active.length > 0) completedBatches++;
    active.length = 0;
    f.clearResponse();
  }
  return {
    async acquireBatch({ scopeCount = 3 } = {}) {
      integer(scopeCount, 'scopeCount', 1, 20);
      check(!disposed, 'lifecycle client is not disposed');
      check(active.length === 0, 'release the previous lifecycle batch first');
      batchStarts++;
      const revision = f.advance();
      const requestsBefore = f.metrics().requests;
      try {
        for (let index = 0; index < scopeCount; index++) {
          const currentScope = { ...scope, scope: `lifecycle-${index}` };
          const wide = f.client.watch(f.definition.bind({}, currentScope));
          const entry = { handles: [wide], unsubscribes: [] };
          active.push(entry);
          check(
            wide.getSnapshot().records === undefined,
            'released scope starts unacquired',
          );
          await wide.ready;
          verifyRecords(
            wide.getSnapshot(),
            recordCount,
            selectionWidth,
            revision,
          );
          if (seenScopes.has(index)) verifiedReacquisitions++;
          seenScopes.add(index);
          const peer = f.client.watch(f.changed.bind({}, currentScope));
          entry.handles.push(peer);
          await peer.ready;
          verifyRecords(peer.getSnapshot(), recordCount, 1, revision);
          for (const handle of entry.handles) {
            entry.unsubscribes.push(
              handle.subscribe(() => {
                notifications++;
                handle.getSnapshot();
              }),
            );
            activeSubscriptions++;
          }
        }
        check(
          f.metrics().requests - requestsBefore === scopeCount,
          'each scope acquires once and shares with its peer',
        );
        f.clearResponse();
        return {
          scopeCount,
          requestDelta: scopeCount,
          verifiedRecords: scopeCount * recordCount,
        };
      } catch (error) {
        release();
        f.dispose();
        disposed = true;
        throw error;
      }
    },
    async releaseBatch() {
      release();
      await Promise.resolve();
    },
    getCounters() {
      return {
        ...f.metrics(),
        batchStarts,
        completedBatches,
        activeScopes: active.length,
        activeOwners: active.reduce(
          (count, entry) => count + entry.handles.length,
          0,
        ),
        activeSubscriptions,
        notifications,
        verifiedReacquisitions,
        disposed,
      };
    },
    dispose() {
      release();
      f.dispose();
      disposed = true;
      seenScopes.clear();
    },
  };
}

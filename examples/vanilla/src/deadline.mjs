import assert from 'node:assert/strict';
import { ReadTimeoutError } from '@tandrove/core';
import { createGraphQLClient, createSchema } from '@tandrove/graphql';

// A controlled timer/transport makes the example deterministic, with no server.
let expire = () => {};
let started = () => {};
const reading = new Promise((resolve) => {
  started = () => resolve(undefined);
});
/** @type {{ signal?: AbortSignal }} */
const observed = {};
const client = createGraphQLClient({
  retry: false,
  requestPolicy: { requestTimeoutMs: 1000 },
  requestPolicyGroups: { forms: { requestTimeoutMs: 100 } },
  deadlineScheduler: {
    wait: () =>
      new Promise((resolve) => {
        expire = resolve;
      }),
  },
  transport: (_operation, context) => {
    if (context) observed.signal = context.signal;
    started();
    return new Promise(() => {});
  },
});
try {
  const item = createSchema(
    'type Query { item: Item! } type Item { name: String! }',
  )
    .field('item')
    .select({ name: true })
    .bind({}, { source: 'example', scope: 'session' });
  const first = client.watch(item, { group: 'forms' });
  const second = client.watch(item, { group: 'forms' });
  const failures = [first, second].map((handle) =>
    assert.rejects(handle.ready, ReadTimeoutError),
  );
  await reading;
  expire();
  await Promise.all(failures);
  assert.equal(first.stateAddress, second.stateAddress);
  assert.equal(observed.signal?.aborted, true);
  assert.equal(first.getSnapshot().fetching, false);
  console.log(
    'Shared deadline: both consumers settled and the transport was aborted.',
  );
} finally {
  client.dispose();
}

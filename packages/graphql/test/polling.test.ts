import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSchema, execute } from 'graphql';
import type { CancellationSignal, FreshnessScheduler } from '@tandrove/core';
import {
  createGraphQLClient,
  createSchema,
  type FieldType,
  type ObjectRef,
  type PreparedOperation,
} from '../src/index.js';

const sdl = `
  type Query { item: Item! }
  type Item { id: ID!, accountId: String!, name: String! }
`;
type Model = {
  Query: { item: FieldType<ObjectRef<'Item'>> };
  Item: {
    id: FieldType<string>;
    accountId: FieldType<string>;
    name: FieldType<string>;
  };
};
const schema = buildSchema(sdl);
const bound = createSchema<Model>(sdl)
  .field('item')
  .select({ accountId: { as: 'account' }, name: true })
  .bind({}, { source: 'polling', scope: 'session' });
const flush = async () => {
  for (let index = 0; index < 100; index++) await Promise.resolve();
};
function clock() {
  let now = 0;
  const timers: {
    due: number;
    signal: CancellationSignal;
    fire: () => void;
    fired: boolean;
  }[] = [];
  const scheduler: FreshnessScheduler = {
    now: () => now,
    wait: (ms, signal) =>
      new Promise<void>((resolve) =>
        timers.push({ due: now + ms, signal, fire: resolve, fired: false }),
      ),
  };
  return {
    scheduler,
    active: () =>
      timers.filter((timer) => !timer.fired && !timer.signal.aborted),
    advance: async (ms: number) => {
      now += ms;
      for (const timer of timers) {
        if (!timer.fired && !timer.signal.aborted && timer.due <= now) {
          timer.fired = true;
          timer.fire();
        }
      }
      await flush();
    },
  };
}

test('shared polling generates an alias-aware narrow operation and retains cached siblings', async (t) => {
  const time = clock();
  const requests: PreparedOperation[] = [];
  const item = { id: '1', accountId: 'account-1', name: 'cached name' };
  const client = createGraphQLClient({
    retry: false,
    pollingScheduler: time.scheduler,
    transport: async (operation) => {
      requests.push(operation);
      return execute({
        schema,
        document: operation.document,
        variableValues: operation.variables,
        rootValue: { item },
      });
    },
  });
  t.after(() => client.dispose());
  const a = client.watch(bound),
    b = client.watch(bound);
  await Promise.all([a.ready, b.ready]);
  assert.equal(requests.length, 1);
  const stopA = a.poll({ target: 'account', everyMs: 50 });
  const stopB = b.poll({ target: 'account', everyMs: 100 });
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(time.active().length, 1);
  item.accountId = 'account-2';
  item.name = 'server name that was not requested';
  await time.advance(50);
  assert.equal(requests.length, 2);
  assert.match(requests[1]!.query, /account:\s*accountId/);
  assert.doesNotMatch(requests[1]!.query, /\bname\b/);
  for (const owner of [a, b]) {
    assert.equal(
      owner.getSnapshot().records?.[0]?.data['account'],
      'account-2',
    );
    assert.equal(owner.getSnapshot().records?.[0]?.data['name'], 'cached name');
  }
  stopA();
  a.dispose();
  assert.equal(time.active().length, 1);
  item.accountId = 'account-3';
  await time.advance(100);
  assert.equal(requests.length, 3);
  assert.equal(b.getSnapshot().records?.[0]?.data['account'], 'account-3');
  stopB();
  stopB();
  assert.equal(time.active().length, 0);
  await time.advance(1000);
  assert.equal(requests.length, 3);
});

test('GraphQL resolves polling defaults through global, group and resource policy without enabling implicit work', async (t) => {
  const time = clock();
  let reads = 0;
  const client = createGraphQLClient({
    retry: false,
    pollingScheduler: time.scheduler,
    requestPolicy: { polling: { everyMs: 100 } },
    resourceGroups: {
      live: { requestPolicy: { polling: { everyMs: 10 } } },
    },
    transport: async (operation) => {
      reads++;
      return execute({
        schema,
        document: operation.document,
        rootValue: {
          item: { id: '1', accountId: `account-${reads}`, name: 'name' },
        },
      });
    },
  });
  t.after(() => client.dispose());
  const active = client.watch(bound, { group: 'live' });
  const disabled = client.watch(bound, {
    group: 'live',
    requestPolicy: { polling: { everyMs: false } },
  });
  await Promise.all([active.ready, disabled.ready]);
  assert.equal(time.active().length, 0);
  const stopDisabled = disabled.poll({ target: 'account' });
  assert.equal(time.active().length, 0);
  const stop = active.poll({ target: 'account' });
  await flush();
  await time.advance(10);
  assert.equal(reads, 2);
  assert.equal(
    disabled.getSnapshot().records?.[0]?.data['account'],
    'account-2',
  );
  stop();
  stopDisabled();
  assert.equal(time.active().length, 0);
});

test(
  'GraphQL provides a default polling clock even when retry is disabled',
  { timeout: 3000 },
  async (t) => {
    let reads = 0;
    const client = createGraphQLClient({
      retry: false,
      transport: async (operation) =>
        execute({
          schema,
          document: operation.document,
          rootValue: {
            item: { id: '1', accountId: `account-${++reads}`, name: 'name' },
          },
        }),
    });
    t.after(() => client.dispose());
    const handle = client.watch(bound);
    await handle.ready;
    const completed = new Promise<void>((resolve) => {
      const unsubscribe = handle.subscribe(() => {
        if (
          handle.getSnapshot().records?.[0]?.data['account'] === 'account-2'
        ) {
          unsubscribe();
          resolve();
        }
      });
      t.after(unsubscribe);
    });
    const stop = handle.poll({ target: 'account', everyMs: 5 });
    await completed;
    stop();
    assert.equal(reads, 2);
  },
);

import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { buildSchema, execute } from 'graphql';
import {
  createGraphQLClient,
  createSchema,
  type FieldType,
  type ObjectRef,
  type PreparedOperation,
} from '../src/index.js';

type Model = {
  Query: {
    item: FieldType<ObjectRef<'Item'> | null>;
    items: FieldType<readonly ObjectRef<'Item'>[]>;
  };
  Item: {
    id: FieldType<string>;
    label: FieldType<string | null>;
    amount: FieldType<number>;
    tags: FieldType<readonly (string | null)[]>;
    user: FieldType<ObjectRef<'User'> | null>;
  };
  User: {
    id: FieldType<string>;
    name: FieldType<string>;
    nickname: FieldType<string | null>;
  };
};
const sdl = `
  type Query { item: Item items: [Item!]! }
  type Item { id: ID! label: String amount: Int! tags: [String]! user: User }
  type User { id: ID! name: String! nickname: String }
`;
const executable = buildSchema(sdl);
const model = createSchema<Model>(sdl, {
  identities: { Item: ['id'], User: ['id'] },
});
const scope = { source: 'typed-snapshots', scope: 'session' };
const item = () => ({
  id: '1',
  label: 'old',
  amount: 10,
  tags: ['first', null],
  user: { id: 'u1', name: 'Ada', nickname: 'A' },
});
const fail = () => {
  throw new Error('selected field failed');
};
function fixture(t: TestContext) {
  const root: Record<string, unknown> = { item: item(), items: [item()] };
  const requests: PreparedOperation[] = [];
  const client = createGraphQLClient({
    transport: async (operation) => {
      requests.push(operation);
      return execute({
        schema: executable,
        document: operation.document,
        rootValue: root,
      });
    },
  });
  t.after(() => client.dispose());
  return { root, requests, client };
}

test('typed selected aliases and nested data retain shared state, readonly values and stable snapshot identity', async (t) => {
  const f = fixture(t);
  const handle = f.client.watch(
    model
      .field('item')
      .select({
        label: { as: 'title' },
        amount: true,
        tags: true,
        user: { select: { name: true } },
      })
      .bind({}, scope),
  );
  assert.equal(handle.getSnapshot().records, undefined);
  await handle.ready;
  const snapshot = handle.getSnapshot();
  const data = snapshot.records![0]!.data;
  const title: string | null | undefined = data.title;
  const amount: number | undefined = data.amount;
  const name: string | undefined = data.user?.name;
  const tags: readonly (string | null)[] | undefined = data.tags;
  assert.equal(title, 'old');
  assert.equal(amount, 10);
  assert.equal(name, 'Ada');
  assert.deepEqual(tags, ['first', null]);
  assert.equal(Object.hasOwn(data, 'label'), false);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.records));
  assert.ok(Object.isFrozen(data));
  assert.ok(Object.isFrozen(data.user));
  assert.ok(Object.isFrozen(data.tags));
  assert.deepEqual(Object.getOwnPropertySymbols(snapshot.records![0]!), []);
  assert.deepEqual(Object.getOwnPropertySymbols(data), []);
  await handle.ensure();
  assert.equal(handle.getSnapshot(), snapshot);
  const peer = f.client.watch(
    model.field('item').select({ label: true }).bind({}, scope),
  );
  await peer.ready;
  assert.equal(f.requests.length, 1);
  const unchangedPeer = peer.getSnapshot();
  let notifications = 0;
  peer.subscribe(() => notifications++);
  f.root['item'] = { ...item(), amount: 20 };
  await handle.refresh('amount');
  assert.equal(peer.getSnapshot(), unchangedPeer);
  assert.equal(notifications, 0);
  assert.equal(handle.getSnapshot().records![0]!.data.amount, 20);
  f.root['item'] = { ...item(), label: 'shared' };
  await handle.refresh('title');
  assert.equal(peer.getSnapshot().records![0]!.data.label, 'shared');
  assert.ok(notifications > 0);
});

test('typed partial data exposes missing selected properties and recovers only failed coverage', async (t) => {
  const f = fixture(t);
  f.root['item'] = { ...item(), label: fail };
  const handle = f.client.watch(
    model
      .field('item')
      .select({ label: { as: 'title' }, amount: true })
      .bind({}, scope),
  );
  await assert.rejects(handle.ready, /selected field failed/);
  const partial = handle.getSnapshot();
  const data = partial.records![0]!.data;
  const title: string | null | undefined = data.title;
  assert.equal(title, undefined);
  assert.equal(Object.hasOwn(data, 'title'), false);
  assert.equal(data.amount, 10);
  assert.equal(partial.complete, false);
  assert.equal(partial.stale, true);
  assert.equal(
    partial.records![0]!.fields.find((field) => field.path[0] === 'title')
      ?.error,
    'selected field failed',
  );
  f.root['item'] = { ...item(), label: 'recovered', amount: 999 };
  await handle.ensure();
  assert.doesNotMatch(f.requests.at(-1)!.query, /amount/);
  assert.equal(handle.getSnapshot().records![0]!.data.title, 'recovered');
  assert.equal(handle.getSnapshot().records![0]!.data.amount, 10);
  assert.equal(handle.getSnapshot().complete, true);
  assert.equal(handle.getSnapshot().error, undefined);
});

test('typed nested failure exposes structural null and partial recovery does not invent sibling fields', async (t) => {
  const f = fixture(t);
  const wide = f.client.watch(
    model
      .field('item')
      .select({ user: { select: { name: true, nickname: true } } })
      .bind({}, scope),
  );
  await wide.ready;
  const narrow = f.client.watch(
    model
      .field('item')
      .select({ user: { select: { name: true } } })
      .bind({}, scope),
  );
  await narrow.ready;
  f.root['item'] = {
    ...item(),
    user: { id: 'u1', name: fail, nickname: 'new' },
  };
  await assert.rejects(narrow.refresh('user.name'), /selected field failed/);
  const failedUser = wide.getSnapshot().records![0]!.data.user;
  assert.equal(failedUser, null);
  assert.equal(wide.getSnapshot().complete, false);
  assert.match(
    wide.getSnapshot().records![0]!.fields[0]!.error!,
    /selected field failed/,
  );
  f.root['item'] = item();
  await narrow.refresh('user.name');
  const user = wide.getSnapshot().records![0]!.data.user;
  const recoveredName: string | undefined = user?.name;
  const missingNickname: string | null | undefined = user?.nickname;
  assert.equal(recoveredName, 'Ada');
  assert.equal(missingNickname, undefined);
  assert.equal(Object.hasOwn(user!, 'nickname'), false);
  assert.equal(wide.getSnapshot().complete, false);
  await wide.ensure();
  assert.equal(wide.getSnapshot().records![0]!.data.user?.nickname, 'A');
  assert.equal(wide.getSnapshot().complete, true);
});

test('typed snapshots preserve successful null values, null resources and empty membership as distinct outcomes', async (t) => {
  const f = fixture(t);
  f.root['item'] = { ...item(), label: null, user: null };
  f.root['items'] = [];
  const single = f.client.watch(
    model
      .field('item')
      .select({ label: true, user: { select: { name: true } } })
      .bind({}, scope),
  );
  const list = f.client.watch(
    model.field('items').select({ label: true }).bind({}, scope),
  );
  await Promise.all([single.ready, list.ready]);
  assert.equal(single.getSnapshot().records![0]!.data.label, null);
  assert.equal(single.getSnapshot().records![0]!.data.user, null);
  assert.equal(single.getSnapshot().complete, true);
  assert.deepEqual(list.getSnapshot().records, []);
  assert.equal(list.getSnapshot().complete, true);
  f.root['item'] = null;
  await single.refresh();
  assert.equal(single.getSnapshot().records, null);
  assert.equal(single.getSnapshot().complete, true);
  assert.equal(single.getSnapshot().resourceError, undefined);
  assert.deepEqual(list.getSnapshot().records, []);
});

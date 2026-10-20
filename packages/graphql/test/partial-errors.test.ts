import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { buildSchema, execute } from 'graphql';
import {
  createSchema,
  createGraphQLClient,
  type FieldType,
  type ObjectRef,
  type PreparedOperation,
} from '../src/index.js';

type Model = {
  Query: {
    item: FieldType<ObjectRef<'Item'> | null>;
    items: FieldType<readonly (ObjectRef<'Item'> | null)[] | null>;
    container: FieldType<ObjectRef<'Container'> | null>;
  };
  Container: { item: FieldType<ObjectRef<'Item'>> };
  Item: {
    id: FieldType<string>;
    label: FieldType<string | null>;
    amount: FieldType<number>;
    user: FieldType<ObjectRef<'User'> | null>;
    tags: FieldType<readonly (string | null)[]>;
  };
  User: {
    id: FieldType<string>;
    name: FieldType<string>;
    nickname: FieldType<string | null>;
  };
};
const sdl = `
  type Query { item: Item items: [Item] container: Container }
  type Container { item: Item! }
  type Item { id: ID! label: String amount: Int! user: User tags: [String]! }
  type User { id: ID! name: String! nickname: String }
`;
const schema = buildSchema(sdl);
const model = createSchema<Model>(sdl, {
  identities: { Item: ['id'], User: ['id'] },
});
const scope = { source: 'test', scope: 'session' };
const fail = () => {
  throw new Error('resolver failed');
};
const item = (id = '1') => ({
  id,
  label: 'old',
  amount: 10,
  user: { id: 'u1', name: 'Ada', nickname: 'A' },
  tags: ['old'],
});
function fixture(t: TestContext) {
  const root: Record<string, unknown> = {
    item: item(),
    items: [item('1'), item('2')],
    container: { item: item() },
  };
  const requests: PreparedOperation[] = [];
  let transform: (result: unknown) => unknown = (result) => result;
  const client = createGraphQLClient({
    transport: async (operation) => {
      requests.push(operation);
      return transform(
        await execute({
          schema,
          document: operation.document,
          rootValue: root,
        }),
      );
    },
  });
  t.after(() => client.dispose());
  return {
    root,
    requests,
    client,
    transform: (next: typeof transform) => {
      transform = next;
    },
  };
}

test('located scalar failures retain cached values, share field errors, commit successes and retry only failed coverage', async (t) => {
  const f = fixture(t);
  const full = f.client.watch(
    model.field('item').select({ label: true, amount: true }).bind({}, scope),
  );
  await full.ready;
  const alias = f.client.watch(
    model
      .field('item')
      .select({ label: { as: 'title' } })
      .bind({}, scope),
  );
  await alias.ready;
  f.root['item'] = { ...item(), label: fail, amount: 20 };
  await assert.rejects(full.refresh(), /resolver failed/);
  assert.equal(full.getSnapshot().records?.[0]?.data['amount'], 20);
  assert.equal(alias.getSnapshot().records?.[0]?.data['title'], 'old');
  assert.equal(
    alias.getSnapshot().records?.[0]?.fields[0]?.error,
    'resolver failed',
  );
  assert.equal(alias.getSnapshot().complete, false);
  assert.equal(alias.getSnapshot().error, undefined); // shared field failure, not this owner's attempt
  f.root['item'] = { ...item(), label: 'recovered', amount: 999 };
  await full.ensure();
  assert.doesNotMatch(f.requests.at(-1)!.query, /amount/);
  assert.equal(full.getSnapshot().records?.[0]?.data['amount'], 20);
  assert.equal(alias.getSnapshot().records?.[0]?.data['title'], 'recovered');
  assert.equal(alias.getSnapshot().complete, true);
});

test('initial partial data is usable and aliases in error paths resolve to canonical fields', async (t) => {
  const f = fixture(t);
  f.root['item'] = { ...item(), label: fail };
  const handle = f.client.watch(
    model
      .field('item')
      .select({ label: { as: 'title' }, amount: true })
      .bind({}, scope),
  );
  await assert.rejects(handle.ready, /resolver failed/);
  assert.equal(handle.getSnapshot().records?.[0]?.data['amount'], 10);
  assert.equal(handle.getSnapshot().records?.[0]?.data['title'], undefined);
  assert.equal(
    handle.getSnapshot().records?.[0]?.fields.find((s) => s.path[0] === 'title')
      ?.error,
    'resolver failed',
  );
});

test('omitted selected fields preserve old values as stale while returned siblings commit', async (t) => {
  const f = fixture(t);
  const handle = f.client.watch(
    model.field('item').select({ label: true, amount: true }).bind({}, scope),
  );
  await handle.ready;
  f.transform(() => ({
    data: { item: { __typename: 'Item', id: '1', amount: 30 } },
  }));
  await assert.rejects(handle.refresh(), /omitted/);
  assert.equal(handle.getSnapshot().records?.[0]?.data['label'], 'old');
  assert.equal(handle.getSnapshot().records?.[0]?.data['amount'], 30);
  assert.equal(handle.getSnapshot().stale, true);
  f.transform((result) => result);
  await handle.ensure();
  assert.doesNotMatch(f.requests.at(-1)!.query, /amount/);
  assert.equal(handle.getSnapshot().stale, false);
});

test('successful nulls overwrite values and structural nulls remove even unrequested cached descendants', async (t) => {
  const f = fixture(t);
  const full = f.client.watch(
    model
      .field('item')
      .select({ label: true, user: { select: { name: true, nickname: true } } })
      .bind({}, scope),
  );
  await full.ready;
  const narrow = f.client.watch(
    model
      .field('item')
      .select({ user: { select: { name: true } } })
      .bind({}, scope),
  );
  await narrow.ready;
  f.root['item'] = { ...item(), label: null, user: null };
  await full.refresh('label');
  assert.equal(full.getSnapshot().records?.[0]?.data['label'], null);
  await narrow.refresh('user.name');
  assert.equal(full.getSnapshot().records?.[0]?.data['user'], null);
  assert.equal(full.getSnapshot().complete, true);
  f.root['item'] = item();
  await narrow.refresh('user.name');
  assert.equal(
    (full.getSnapshot().records?.[0]?.data['user'] as Record<string, unknown>)[
      'nickname'
    ],
    undefined,
  );
  assert.equal(full.getSnapshot().complete, false);
});

test('non-null child failures bubble to a shared structural null, then recover without resurrecting siblings', async (t) => {
  const f = fixture(t);
  const full = f.client.watch(
    model
      .field('item')
      .select({
        amount: true,
        user: { select: { name: true, nickname: true } },
      })
      .bind({}, scope),
  );
  await full.ready;
  const narrow = f.client.watch(
    model
      .field('item')
      .select({ user: { as: 'owner', select: { name: { as: 'display' } } } })
      .bind({}, scope),
  );
  await narrow.ready;
  f.root['item'] = {
    ...item(),
    user: { id: 'u1', name: fail, nickname: 'new' },
  };
  await assert.rejects(narrow.refresh('owner.display'), /resolver failed/);
  assert.equal(full.getSnapshot().records?.[0]?.data['user'], null);
  assert.equal(full.getSnapshot().records?.[0]?.data['amount'], 10);
  assert.equal(
    full.getSnapshot().records?.[0]?.fields.find((s) => s.path[0] === 'user')
      ?.error,
    'resolver failed',
  );
  assert.equal(full.getSnapshot().complete, false);
  f.root['item'] = item();
  await narrow.ensure();
  assert.equal(
    (full.getSnapshot().records?.[0]?.data['user'] as Record<string, unknown>)[
      'nickname'
    ],
    undefined,
  );
  assert.equal(narrow.getSnapshot().complete, true);
});

test('resource and ancestor nulls are shared, distinguish success from failure, and invalidate for reacquisition', async (t) => {
  const f = fixture(t);
  const path = model.field('container').field('item');
  const full = f.client.watch(
    path.select({ label: true, amount: true }).bind({}, scope),
  );
  await full.ready;
  const narrow = f.client.watch(path.select({ amount: true }).bind({}, scope));
  await narrow.ready;
  f.root['container'] = null;
  await narrow.refresh();
  assert.equal(full.getSnapshot().records, null);
  assert.equal(full.getSnapshot().complete, true);
  const count = f.requests.length;
  await full.ensure();
  assert.equal(f.requests.length, count);
  f.root['container'] = { item: item() };
  await narrow.invalidate();
  assert.equal(full.getSnapshot().records?.[0]?.data['label'], undefined);
  f.root['container'] = { item: { ...item(), amount: fail } };
  await assert.rejects(narrow.refresh(), /resolver failed/);
  assert.equal(full.getSnapshot().records, null);
  assert.equal(full.getSnapshot().resourceError, 'resolver failed');
  assert.equal(full.getSnapshot().complete, false);
  f.root['container'] = { item: item() };
  await full.ensure();
  assert.equal(full.getSnapshot().resourceError, undefined);
  assert.equal(full.getSnapshot().complete, true);
});

test('singleton identity replacement discards all old siblings', async (t) => {
  const f = fixture(t);
  const full = f.client.watch(
    model.field('item').select({ label: true, amount: true }).bind({}, scope),
  );
  await full.ready;
  f.root['item'] = { ...item('new'), amount: 42 };
  await full.refresh('amount');
  assert.equal(full.getSnapshot().records?.[0]?.identity['id'], 'new');
  assert.equal(full.getSnapshot().records?.[0]?.data['amount'], 42);
  assert.equal(full.getSnapshot().records?.[0]?.data['label'], undefined);
  assert.equal(full.getSnapshot().complete, false);
});

test('list error indexes map through returned identities, and failed list refresh cannot admit newcomers', async (t) => {
  const f = fixture(t);
  const handle = f.client.watch(
    model.field('items').select({ label: true, amount: true }).bind({}, scope),
  );
  await handle.ready;
  f.root['items'] = [
    { ...item('2'), label: fail, amount: 22 },
    { ...item('1'), label: 'new', amount: 11 },
  ];
  await assert.rejects(handle.refresh(), /resolver failed/);
  assert.deepEqual(
    handle.getSnapshot().records?.map((r) => r.data['label']),
    ['new', 'old'],
  );
  assert.equal(
    handle.getSnapshot().records?.[1]?.fields.find((s) => s.path[0] === 'label')
      ?.error,
    'resolver failed',
  );
  f.root['items'] = [{ ...item('2'), label: fail }, item('3')];
  await assert.rejects(handle.refreshList(), /resolver failed/);
  assert.deepEqual(
    handle.getSnapshot().records?.map((r) => r.identity['id']),
    ['1', '2'],
  );
  assert.equal(handle.getSnapshot().membershipStale, true);
  f.root['items'] = [item('2'), item('3')];
  await handle.refreshList();
  assert.deepEqual(
    handle.getSnapshot().records?.map((r) => r.identity['id']),
    ['2', '3'],
  );
  assert.equal(handle.getSnapshot().stale, false);
});

test('scalar-list element failures retain the previous field while other fields succeed', async (t) => {
  const f = fixture(t);
  const handle = f.client.watch(
    model.field('item').select({ tags: true, amount: true }).bind({}, scope),
  );
  await handle.ready;
  f.root['item'] = { ...item(), tags: [new Error('bad tag')], amount: 20 };
  await assert.rejects(handle.refresh(), /bad tag/);
  assert.deepEqual(handle.getSnapshot().records?.[0]?.data['tags'], ['old']);
  assert.equal(handle.getSnapshot().records?.[0]?.data['amount'], 20);
  assert.equal(
    handle.getSnapshot().records?.[0]?.fields.find((s) => s.path[0] === 'tags')
      ?.error,
    'bad tag',
  );
});

test('a scalar-list failure does not bypass validation of malformed sibling values', async (t) => {
  const f = fixture(t);
  const handle = f.client.watch(
    model.field('item').select({ tags: true, amount: true }).bind({}, scope),
  );
  await handle.ready;
  const before = handle.getSnapshot().records;
  for (const fields of [
    { tags: [null, 123], amount: 999 },
    { tags: [null, 'valid'], amount: null },
  ]) {
    f.transform(() => ({
      data: { item: { __typename: 'Item', id: '1', ...fields } },
      errors: [{ message: 'tag failed', path: ['item', 'tags', 0] }],
    }));
    await assert.rejects(handle.refresh(), /String|scalar|non-null/);
    assert.deepEqual(handle.getSnapshot().records, before);
  }
});

test('unlocatable or contradictory errors and unidentified null list items reject atomically', async (t) => {
  const f = fixture(t);
  const handle = f.client.watch(
    model.field('items').select({ label: true, amount: true }).bind({}, scope),
  );
  await handle.ready;
  const before = handle.getSnapshot().records;
  const row = { __typename: 'Item', ...item(), label: null, amount: 99 };
  for (const error of [
    { message: 'no path' },
    { message: 'unknown', path: ['items', 0, 'unknown'] },
    { message: 'bad index', path: ['items', 2, 'label'] },
    { message: 'wrong type', path: ['items', '0', 'label'] },
    { message: 'not null', path: ['items', 0, 'amount'] },
  ]) {
    f.transform(() => ({ data: { items: [row] }, errors: [error] }));
    await assert.rejects(handle.refresh());
    assert.deepEqual(handle.getSnapshot().records, before);
  }
  f.transform(() => ({ data: { items: [row, null] } }));
  await assert.rejects(handle.refresh(), /object/);
  assert.deepEqual(handle.getSnapshot().records, before);
});

test('multiple failures can share a null ancestor without losing valid sibling data', async (t) => {
  const f = fixture(t);
  const handle = f.client.watch(
    model
      .field('item')
      .select({
        amount: true,
        user: { select: { name: true, nickname: true } },
      })
      .bind({}, scope),
  );
  await handle.ready;
  // Return a valid envelope with two execution errors; the non-null name
  // failure bubbles above the nullable nickname failure.
  f.transform(() => ({
    data: { item: { __typename: 'Item', id: '1', amount: 42, user: null } },
    errors: [
      { message: 'nickname failed', path: ['item', 'user', 'nickname'] },
      { message: 'name failed', path: ['item', 'user', 'name'] },
    ],
  }));
  await assert.rejects(handle.refresh(), /nickname failed.*name failed/);
  assert.equal(handle.getSnapshot().records?.[0]?.data['user'], null);
  assert.equal(handle.getSnapshot().records?.[0]?.data['amount'], 42);
});

test('null data from non-null root bubbling is a failed shared resource and recovers', async (t) => {
  const rootSchema = buildSchema(
    'type Query { item: Item! } type Item { id: ID! amount: Int! }',
  );
  type RootModel = {
    Query: { item: FieldType<ObjectRef<'Item'>> };
    Item: { amount: FieldType<number> };
  };
  const rootModel = createSchema<RootModel>(
    'type Query { item: Item! } type Item { id: ID! amount: Int! }',
    { identities: { Item: ['id'] } },
  );
  let broken = true;
  const client = createGraphQLClient({
    transport: (operation) =>
      Promise.resolve(
        execute({
          schema: rootSchema,
          document: operation.document,
          rootValue: { item: { id: '1', amount: broken ? fail : 10 } },
        }),
      ),
  });
  t.after(() => client.dispose());
  const handle = client.watch(
    rootModel.field('item').select({ amount: true }).bind({}, scope),
  );
  await assert.rejects(handle.ready, /resolver failed/);
  assert.equal(handle.getSnapshot().records, null);
  assert.equal(handle.getSnapshot().resourceError, 'resolver failed');
  broken = false;
  await handle.ensure();
  assert.equal(handle.getSnapshot().records?.[0]?.data['amount'], 10);
  assert.equal(handle.getSnapshot().complete, true);
});

test('a null collection differs from empty membership and can recover to a populated list', async (t) => {
  const f = fixture(t);
  f.root['items'] = null;
  const handle = f.client.watch(
    model.field('items').select({ label: true }).bind({}, scope),
  );
  await handle.ready;
  assert.equal(handle.getSnapshot().records, null);
  assert.equal(handle.getSnapshot().complete, true);
  f.root['items'] = [];
  await handle.refreshList();
  assert.deepEqual(handle.getSnapshot().records, []);
  f.root['items'] = [item()];
  await handle.refreshList();
  assert.equal(handle.getSnapshot().records?.[0]?.data['label'], 'old');
});

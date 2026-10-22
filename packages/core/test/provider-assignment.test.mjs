import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AcquisitionClient,
  createAcquisitionSourceToken,
  createProviderScope,
  createProviderToken,
  provide,
} from '../dist/index.js';

const field = (name) => ({
  name,
  responseName: name,
  arguments: {},
  children: [],
});
const selection = [field('name'), field('amount')];
const rows = (fields, value = 1) => [
  {
    identity: { id: '1' },
    fields: fields.map((f) => ({
      kind: 'write',
      path: [{ name: f.name, arguments: {} }],
      value,
    })),
  },
];
function source(address = 'item', value = 1) {
  const calls = [];
  return {
    stateAddress: address,
    selection,
    calls,
    async read(fields) {
      this.calls.push(fields);
      return rows(fields, value);
    },
  };
}
function descriptor(input, fields = input.selection) {
  return {
    stateAddress: input.stateAddress,
    selection: fields,
    collection: input.collection,
  };
}
function fixture(t, configure = () => ({})) {
  const a = source(),
    b = source('other', 2);
  const first = createAcquisitionSourceToken('first'),
    alias = createAcquisitionSourceToken('alias'),
    second = createAcquisitionSourceToken('second');
  let disposed = 0;
  const scope = createProviderScope([
    provide(first, {
      useValue: a,
      ownership: 'owned',
      dispose: () => {
        disposed++;
      },
    }),
    provide(alias, { useValue: a }),
    provide(second, { useValue: b }),
  ]);
  const client = new AcquisitionClient({
    providerScope: scope,
    ...configure({ first, alias, second }),
  });
  t.after(async () => {
    client.dispose();
    await scope.dispose();
  });
  return {
    a,
    b,
    first,
    alias,
    second,
    scope,
    client,
    disposed: () => disposed,
  };
}

test('global, group and resource assignments share real sources without changing addresses', async (t) => {
  const f = fixture(t, ({ first, alias, second }) => ({
    providers: { acquisition: first },
    resourceGroups: {
      other: { providers: { acquisition: second } },
      same: { providers: { acquisition: alias } },
    },
  }));
  const a = f.client.watch(descriptor(f.a));
  const alias = f.client.watch(descriptor(f.a), { group: 'same' });
  const b = f.client.watch(descriptor(f.b), { group: 'other' });
  const override = f.client.watch(descriptor(f.a), {
    group: 'other',
    providers: { acquisition: f.first },
  });
  await Promise.all([a.ready, alias.ready, b.ready, override.ready]);
  assert.equal(a.stateAddress, alias.stateAddress);
  assert.equal(f.a.calls.length, 1);
  assert.equal(f.b.calls.length, 1);
  assert.equal(b.getSnapshot().records[0].data.name, 2);
  a.dispose();
  alias.dispose();
  override.dispose();
  f.client.dispose();
  assert.equal(f.disposed(), 0);
  const secondClient = new AcquisitionClient({
    providerScope: f.scope,
    providers: { acquisition: f.first },
  });
  await secondClient.watch(descriptor(f.a)).ready;
  secondClient.dispose();
  await f.scope.dispose();
  assert.equal(f.disposed(), 1);
});

test('disable stops fallback, inherits, and can be explicitly re-enabled', async (t) => {
  const f = fixture(t, ({ first }) => ({
    providers: { acquisition: false },
    resourceGroups: { on: { providers: { acquisition: first } }, off: {} },
  }));
  assert.throws(() => f.client.watch(f.a), /disabled/);
  assert.throws(() => f.client.watch(f.a, { group: 'off' }), /disabled/);
  assert.throws(
    () =>
      f.client.watch(f.a, { group: 'on', providers: { acquisition: false } }),
    /disabled/,
  );
  assert.equal(f.a.calls.length, 0);
  await f.client.watch(descriptor(f.a), {
    group: 'off',
    providers: { acquisition: f.first },
  }).ready;
  await f.client.watch(f.a, { group: 'on' }).ready;
  assert.equal(f.a.calls.length, 1);
});

test('captured group policies and providers resist later configuration mutation', async (t) => {
  let config;
  const f = fixture(t, ({ first, second }) => {
    config = {
      providers: { acquisition: first },
      requestPolicy: { retentionMs: 0 },
      resourceGroups: {
        group: {
          providers: { acquisition: first },
          requestPolicy: { retentionMs: false },
        },
      },
    };
    return config;
  });
  config.providers.acquisition = f.second;
  config.resourceGroups.group.providers.acquisition = f.second;
  config.resourceGroups.group.requestPolicy.retentionMs = 20;
  const a = f.client.watch(descriptor(f.a), { group: 'group' });
  await a.ready;
  const overrides = {
    group: 'group',
    providers: { acquisition: f.alias },
    requestPolicy: { retentionMs: false },
  };
  const b = f.client.watch(descriptor(f.a), overrides);
  overrides.providers.acquisition = f.second;
  await b.ready;
  await b.refresh();
  assert.equal(f.b.calls.length, 0);
  assert.throws(
    () => f.client.watch(descriptor(f.a)),
    /same effective retentionMs/,
  );
});

test('legacy policy groups coexist, but duplicate group declarations and invalid options fail', async (t) => {
  const f = fixture(t, ({ first }) => ({
    providers: { acquisition: first },
    requestPolicyGroups: { legacy: { retentionMs: 0 } },
    resourceGroups: { modern: { requestPolicy: { retentionMs: 0 } } },
  }));
  await f.client.watch(descriptor(f.a), { group: 'legacy' }).ready;
  await f.client.watch(descriptor(f.a), { group: 'modern' }).ready;
  assert.throws(
    () => f.client.watch(f.a, { group: 'missing' }),
    /Unknown.*group/,
  );
  assert.throws(
    () =>
      new AcquisitionClient({
        resourceGroups: { same: {} },
        requestPolicyGroups: { same: {} },
      }),
    /both/,
  );
  for (const options of [
    { resourceGroups: { '': {} } },
    { resourceGroups: { x: { typo: true } } },
    { providers: { stream: false } },
    { providers: { acquisition: { description: 'fake' } } },
    { resourceGroups: { x: { requestPolicy: null } } },
  ])
    assert.throws(() => new AcquisitionClient(options));
  assert.throws(
    () => new AcquisitionClient({ providers: { acquisition: f.first } }),
    /providerScope/,
  );
  assert.throws(
    () => f.client.watch(f.a, { providers: { stream: false } }),
    /Unsupported/,
  );
  assert.throws(
    () => f.client.watch(f.a, { typo: true }),
    /Unknown resource option/,
  );
});

test('unready, missing and mismatched providers cannot initialize or attach work implicitly', async (t) => {
  let starts = 0;
  const value = source();
  const token = createAcquisitionSourceToken();
  const wrong = createProviderToken('number', (x) => typeof x === 'number');
  const missing = createAcquisitionSourceToken('missing');
  const scope = createProviderScope([
    provide(token, {
      useFactory: async () => {
        starts++;
        return value;
      },
    }),
    provide(wrong, { useValue: 3 }),
  ]);
  const client = new AcquisitionClient({
    providerScope: scope,
    providers: { acquisition: token },
  });
  t.after(async () => {
    client.dispose();
    await scope.dispose();
  });
  assert.throws(() => client.watch(descriptor(value)), /ready|resolve/i);
  assert.equal(starts, 0);
  assert.throws(
    () => client.watch(value, { providers: { acquisition: missing } }),
    /registered/,
  );
  assert.throws(
    () => client.watch(value, { providers: { acquisition: wrong } }),
    /capability acquisition/,
  );
  assert.equal(value.calls.length, 0);
  await scope.resolve(token);
  await client.watch(descriptor(value)).ready;
  assert.equal(starts, 1);
});

test('bound providers must match address, collection, aliases, arguments and selected fields', async (t) => {
  const f = fixture(t, ({ first }) => ({ providers: { acquisition: first } }));
  for (const invalid of [
    descriptor(f.b),
    { ...descriptor(f.a), collection: true },
    descriptor(f.a, [field('absent')]),
    descriptor(f.a, [{ ...field('name'), responseName: 'alias' }]),
    descriptor(f.a, [{ ...field('name'), arguments: { id: 1 } }]),
  ])
    assert.throws(() => f.client.watch(invalid));
  assert.equal(f.a.calls.length, 0);
  for (const collection of ['true', 'false', null, 0, 1])
    assert.throws(
      () => f.client.watch({ ...descriptor(f.a), collection }),
      /boolean collection/,
    );
  for (const stateAddress of ['', null, 0])
    assert.throws(
      () => f.client.watch({ ...descriptor(f.a), stateAddress }),
      /nonempty stateAddress/,
    );
  assert.equal(f.a.calls.length, 0);
  await f.client.watch(descriptor(f.a)).ready;
});

test('whole-resource providers retain fetch coverage but commit only the descriptor selection', async (t) => {
  const f = fixture(t, ({ first }) => ({ providers: { acquisition: first } }));
  f.a.fetchSelection = () => selection;
  const a = f.client.watch(descriptor(f.a, [field('name')]));
  await a.ready;
  assert.deepEqual(f.a.calls[0].map((f) => f.name).sort(), ['amount', 'name']);
  assert.equal(a.getSnapshot().records[0].data.amount, undefined);
  const b = f.client.watch(descriptor(f.a, [field('amount')]));
  await b.ready;
  assert.equal(f.a.calls.length, 2);
  await a.invalidate('name');
  assert.equal(b.getSnapshot().records[0].data.amount, 1);
});

test('different source instances sharing a prototype method still conflict, including ingress', async (t) => {
  class Backend {
    stateAddress = 'item';
    selection = selection;
    constructor(value) {
      this.value = value;
    }
    async read(fields) {
      return rows(fields, this.value);
    }
  }
  const a = new Backend(1),
    b = new Backend(2),
    client = new AcquisitionClient();
  t.after(() => client.dispose());
  assert.equal(a.read, b.read);
  const handle = client.watch(a);
  await handle.ready;
  assert.throws(() => client.watch(b), /same authority/);
  assert.throws(
    () =>
      client.ingest(b, {
        selection: [field('name')],
        records: rows([field('name')], 3),
      }),
    /same authority/,
  );
  handle.dispose();
  assert.throws(() => client.watch(b), /same authority/);
  const active = client.watch(a);
  await active.ready;
  client.ingest(a, {
    selection: [field('name')],
    records: rows([field('name')], 4),
  });
  assert.equal(active.getSnapshot().records[0].data.name, 4);
  assert.equal(await client.watch(a).ready, undefined);
});

test('explicit equivalent wrappers share authority; eviction releases the authority binding', async (t) => {
  const a = source(),
    b = source('item', 2),
    client = new AcquisitionClient({ requestPolicy: { retentionMs: 0 } });
  t.after(() => client.dispose());
  a.authority = {};
  const first = client.watch(a);
  await first.ready;
  const alias = client.watch({ ...a, selection: [field('name')] });
  await alias.ready;
  first.dispose();
  assert.throws(() => client.watch(b), /same authority/);
  alias.dispose();
  const replacement = client.watch(b);
  await replacement.ready;
  assert.equal(replacement.getSnapshot().records[0].data.name, 2);
  assert.throws(
    () =>
      client.ingest(a, {
        selection: [field('name')],
        records: rows([field('name')], 9),
      }),
    /same authority/,
  );
  assert.equal(replacement.getSnapshot().records[0].data.name, 2);
});

test('assigned custom results still use the common commit validator', async (t) => {
  const f = fixture(t, ({ first }) => ({ providers: { acquisition: first } }));
  f.a.read = async () => rows([field('unrequested')]);
  const handle = f.client.watch(descriptor(f.a));
  await assert.rejects(handle.ready);
  assert.equal(handle.getSnapshot().records, undefined);
});

test('invalid authority fails registration, direct watches, assigned watches and ingress', async (t) => {
  const f = fixture(t, ({ first }) => ({ providers: { acquisition: first } }));
  await f.client.watch(f.a).ready;
  const direct = new AcquisitionClient();
  t.after(() => direct.dispose());
  for (const authority of [null, false, 1, 'backend']) {
    const invalid = { ...f.a, authority };
    assert.throws(
      () => provide(createAcquisitionSourceToken(), { useValue: invalid }),
      /satisfy/,
    );
    assert.throws(() => direct.watch(invalid), /acquisition source/);
    assert.throws(
      () => f.client.ingest(invalid, { selection, records: rows(selection) }),
      /authority/,
    );
    f.a.authority = authority;
    assert.throws(
      () => f.client.watch(descriptor(f.a)),
      /capability acquisition/,
    );
    delete f.a.authority;
  }
  assert.equal(f.a.calls.length, 1);
});

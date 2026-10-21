import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute, parse, validate } from 'graphql';
import {
  canonicalInput,
  snapshotInput,
  resourceAddress,
  freezeFields,
  mergeFields,
} from '@launch-echo/stateql-core';
import { schema as generated } from '../../../examples/query-planner/src/generated/billing.js';
import {
  schema,
  schemaSource,
  createRoot,
} from '../../../apps/billing-api/src/schema.js';
import { BillingFixture } from '../../../apps/billing-api/src/fixture.js';
import { createSchema, type FieldType, type ObjectRef } from '../src/index.js';
import { generateSchemaModule } from '../src/codegen.js';

const scope = { source: 'billing-api', scope: 'session-1' };
const args = {
  billing: { tenantId: 'A' },
  'billing.invoices': { status: 'OPEN' as const },
};
const resource = generated.field('billing').field('invoices');
const base = resource.select({
  accountId: true,
  amountCents: true,
  user: { select: { name: true } },
});

test('composition rejects duplicate canonical fields even in raw inputs', () => {
  const duplicates = ['retail', 'wholesale'].map((responseName) => ({
    name: 'price',
    responseName,
    arguments: {},
    children: [],
  }));
  assert.throws(() => freezeFields(duplicates), /Duplicate canonical/);
  assert.throws(() => mergeFields(duplicates, []), /Duplicate canonical/);
  assert.throws(() => mergeFields([], duplicates), /Duplicate canonical/);
});

test('full and narrow requests execute against fixture schema with the same state address', async () => {
  const bound = base.bind(args, scope);
  const full = bound.prepare();
  const narrow = bound.prepare('accountId');
  assert.equal(full.stateAddress, narrow.stateAddress);
  assert.notEqual(full.fingerprint, narrow.fingerprint);
  assert.deepEqual(validate(schema, narrow.document), []);
  assert.equal(narrow.query.includes('amountCents'), false);
  assert.equal(narrow.query.includes('user'), false);
  assert.match(narrow.query, /__typename/);
  assert.match(narrow.query, /id/);
  assert.match(narrow.query, /\$v0: ID!/);
  assert.match(narrow.query, /\$v1: InvoiceStatus/);
  assert.deepEqual(Object.values(narrow.variables), ['A', 'OPEN']);
  const fixture = new BillingFixture();
  const result = await execute({
    schema,
    document: narrow.document,
    variableValues: narrow.variables,
    rootValue: createRoot(fixture, fixture.snapshot(), false),
  });
  assert.equal(result.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    billing: {
      __typename: 'Billing',
      tenantId: 'A',
      invoices: [
        {
          __typename: 'Invoice',
          tenantId: 'A',
          id: 'INV-1',
          accountId: 'A-ledger-1-v1',
        },
      ],
    },
  });
  assert.deepEqual(narrow.responsePath, ['billing', 'invoices']);
});

test('nested refresh retains ancestor context, selects only requested child and identity', () => {
  const query = base.bind(args, scope).prepare('user.name').query;
  assert.match(query, /user \{/);
  assert.match(query, /name/);
  assert.equal(query.includes('accountId'), false);
  assert.equal(query.includes('amountCents'), false);
  assert.deepEqual(validate(schema, parse(query)), []);
});

test('composition is immutable, merges nested selections, and rejects conflicting overrides', () => {
  const initial = canonicalInput(base.selection);
  const extended = base.extend({
    status: true,
    user: { select: { id: true } },
  });
  assert.equal(canonicalInput(base.selection), initial);
  assert.match(extended.bind(args, scope).prepare().query, /status/);
  assert.equal(
    base.bind(args, scope).stateAddress,
    extended.bind(args, scope).stateAddress,
  );
  assert.deepEqual(
    extended.extend({ status: true }).selection,
    extended.selection,
  );
  assert.equal(
    base.select({ accountId: true }).bind(args, scope).stateAddress,
    base.bind(args, scope).stateAddress,
  );
  assert.throws(() => base.select({ status: true }), /subset/);
  assert.throws(() => base.extend({ accountId: { as: 'ledger' } }), /override/);
  assert.throws(
    () =>
      resource.select({
        accountId: { as: 'same' },
        amountCents: { as: 'same' },
      }),
    /response name/,
  );
  assert.throws(() => resource.select({ accountId: { as: 'id' } }), /identity/);
  assert.throws(
    () => resource.select({ accountId: { as: '__typename' } }),
    /alias/,
  );
});

test('alias resolves to canonical address but changes response projection', async () => {
  const alias = resource
    .select({ accountId: { as: 'ledger' } })
    .bind(args, scope);
  const normal = base.bind(args, scope);
  assert.equal(alias.stateAddress, normal.stateAddress);
  assert.equal(
    alias.address('ledger', { id: 'INV-1' }),
    normal.address('accountId', { id: 'INV-1' }),
  );
  const prepared = alias.prepare('ledger');
  assert.match(prepared.query, /ledger: accountId/);
  const fixture = new BillingFixture();
  const result = await execute({
    schema,
    document: prepared.document,
    variableValues: prepared.variables,
    rootValue: createRoot(fixture, fixture.snapshot(), false),
  });
  assert.equal(result.errors, undefined);
  assert.ok(JSON.stringify(result.data).includes('"ledger":"A-ledger-1-v1"'));
});

test('addresses include source, client scope, ancestor/local arguments and record identity', () => {
  const a = base.bind(args, scope);
  for (const other of [
    base.bind({ billing: { tenantId: 'B' } }, scope),
    base.bind({ billing: { tenantId: 'A' } }, scope),
    base.bind(args, { ...scope, scope: 'other' }),
    base.bind(args, { ...scope, source: 'other' }),
  ])
    assert.notEqual(a.stateAddress, other.stateAddress);
  assert.notEqual(
    a.address('accountId', { id: '1' }),
    a.address('accountId', { id: '2' }),
  );
  const reverse = base.bind(
    { 'billing.invoices': { status: 'OPEN' }, billing: { tenantId: 'A' } },
    scope,
  );
  assert.equal(reverse.prepare().fingerprint, a.prepare().fingerprint);
  assert.notEqual(
    base.bind(
      { billing: { tenantId: 'A' }, 'billing.invoices': { status: null } },
      scope,
    ).stateAddress,
    base.bind({ billing: { tenantId: 'A' } }, scope).stateAddress,
  );
});

test('caller mutation cannot alter definitions, bindings, variables, or documents', () => {
  const selection = {
    accountId: true as const,
    user: { select: { name: true as const } },
  };
  const definition = resource.select(selection);
  const inputs = { billing: { tenantId: 'A' } };
  const bound = definition.bind(inputs, scope);
  inputs.billing.tenantId = 'B';
  const fingerprint = bound.prepare().fingerprint;
  assert.match(fingerprint, /A/);
  assert.throws(() => {
    (definition.selection as unknown as unknown[]).push({});
  }, TypeError);
  const prepared = bound.prepare();
  assert.throws(() => {
    (prepared.variables as Record<string, unknown>)['v0'] = 'changed';
  }, TypeError);
  assert.throws(() => {
    (prepared.document.definitions as unknown[]).push({});
  }, TypeError);
  assert.equal(bound.prepare().fingerprint, fingerprint);
});

test('untyped callers still get field, argument, and selection validation', () => {
  // Deliberately bypass types to test the public JavaScript boundary.
  assert.throws(
    () => resource.select({ unknown: true } as never),
    /Unknown field/,
  );
  assert.throws(
    () => resource.select({ user: { select: { missing: true } } } as never),
    /Unknown field/,
  );
  assert.throws(() => base.bind({} as never, scope), /Missing argument/);
  assert.throws(
    () => base.bind({ billing: { tenantId: false } } as never, scope),
    /ID/,
  );
  assert.throws(
    () =>
      base.bind(
        { ...args, 'billing.invoices': { status: 'NOPE' } } as never,
        scope,
      ),
    /InvoiceStatus/,
  );
  assert.throws(
    () => base.bind({ ...args, x: {} } as never, scope),
    /argument path/,
  );
  assert.throws(
    () => resource.select({ accountId: { skip: true } } as never),
    /option/,
  );
  assert.throws(
    () => base.bind(args, scope).prepare('nope' as never),
    /Unknown selected field/,
  );
});

test('schema subset and identity requirements fail explicitly before execution', () => {
  assert.throws(
    () =>
      generateSchemaModule(
        'interface Node { id: ID! } type Query { node: Node }',
      ),
    /Abstract type/,
  );
  assert.throws(
    () => generateSchemaModule('scalar Date type Query { now: Date }'),
    /Custom scalar/,
  );
  assert.throws(
    () =>
      generateSchemaModule(
        'directive @custom on FIELD_DEFINITION type Query { name: String @custom }',
      ),
    /Custom directive/,
  );
  assert.throws(
    () =>
      generateSchemaModule(schemaSource, {
        identities: { Invoice: ['accountId'] },
      }),
    /required scalar/,
  );
  const unconfigured =
    createSchema<
      import('../../../examples/query-planner/src/generated/billing.js').GeneratedTypes
    >(schemaSource);
  assert.throws(
    () =>
      unconfigured
        .field('billing')
        .field('invoices')
        .select({ accountId: true })
        .bind(args, scope)
        .prepare(),
    /identity/,
  );
  assert.throws(() => resource.field('user'), /nested selection/);
});

test('GraphQL input coercion normalizes defaults and list inputs before addressing', () => {
  type Types = {
    Query: {
      items: FieldType<
        readonly ObjectRef<'Item'>[],
        { limit?: number; tags?: readonly string[] | null }
      >;
    };
    Item: { id: FieldType<string> };
  };
  const model = createSchema<Types>(
    'type Query { items(limit: Int! = 10, tags: [String!]): [Item!]! } type Item { id: ID! }',
    { identities: { Item: ['id'] } },
  )
    .field('items')
    .select({ id: true });
  assert.equal(
    model.bind({}, scope).stateAddress,
    model.bind({ items: { limit: 10 } }, scope).stateAddress,
  );
  assert.equal(
    model.bind({ items: { tags: 'a' } } as never, scope).stateAddress,
    model.bind({ items: { tags: ['a'] } }, scope).stateAddress,
  );
});

test('canonical input rejects lossy values and preserves meaningful JSON distinctions', () => {
  assert.equal(
    canonicalInput({ b: 2, a: 1 }),
    canonicalInput({ a: 1, b: 2, omitted: undefined }),
  );
  assert.notEqual(canonicalInput({ a: null }), canonicalInput({}));
  assert.notEqual(canonicalInput([1, 2]), canonicalInput([2, 1]));
  for (const value of [
    NaN,
    Infinity,
    new Date(),
    [undefined],
    () => 1,
    {
      get a() {
        return 1;
      },
    },
  ])
    assert.throws(() => snapshotInput(value));
  const cycle: Record<string, unknown> = {};
  cycle['self'] = cycle;
  assert.throws(() => snapshotInput(cycle), /Cyclic/);
  const shared = { a: 1 };
  assert.equal(canonicalInput([shared, shared]), '[{"a":1},{"a":1}]');
  const plain = [{ name: 'invoices', arguments: {} }];
  const projected = [{ ...plain[0]!, responseName: 'alias', children: [] }];
  assert.equal(
    resourceAddress(scope, plain),
    resourceAddress(scope, projected),
  );
});

test('nested field arguments preserve defaults and reject incompatible extensions', () => {
  type Types = {
    Query: { item: FieldType<ObjectRef<'Item'>> };
    Item: { label: FieldType<string, { language?: string | null }> };
  };
  const model = createSchema<Types>(
    'type Query { item: Item! } type Item { label(language: String = "en"): String! }',
  ).field('item');
  const definition = model.select({ label: { args: { language: 'en' } } });
  assert.deepEqual(
    definition.extend({ label: true }).selection,
    definition.selection,
  );
  assert.throws(
    () => definition.extend({ label: { args: { language: 'fr' } } }),
    /override/,
  );
  const first = definition.bind({}, scope);
  const second = model
    .select({ label: { args: { language: 'fr' } } })
    .bind({}, scope);
  assert.equal(first.stateAddress, second.stateAddress);
  assert.notEqual(first.address('label'), second.address('label'));
  assert.deepEqual(Object.values(first.prepare().variables), ['en']);
});

test('generator preserves input objects, enums, lists, nullability and required/default arguments', () => {
  const output = generateSchemaModule(
    'enum Lang { EN FR } input Filter { ids: [ID!]!, lang: Lang = EN } type Query { item(filter: Filter!): Item } type Item { name: String }',
  );
  assert.match(output, /readonly "ids": readonly \(string\)\[\]/);
  assert.match(output, /readonly "lang"\?: "EN" \| "FR" \| null/);
  assert.match(output, /readonly "filter": Inputs\["Filter"\]/);
  assert.match(output, /ObjectRef<"Item"> \| null/);
  const scalarOnly = generateSchemaModule('type Query { name: String }');
  assert.equal(scalarOnly.includes('type ObjectRef'), false);
});

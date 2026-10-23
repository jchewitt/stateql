import type {
  InputObject,
  InputValue,
  QueryHandle,
  SnapshotData,
} from '@tandrove/core';
import {
  createGraphQLClient,
  createSchema,
  type FieldType,
  type ObjectRef,
  type ResultOf,
  type Selection,
} from '../src/index.js';

type Model = {
  Query: { item: FieldType<ObjectRef<'Item'> | null> };
  Item: {
    id: FieldType<string>;
    label: FieldType<string | null>;
    amount: FieldType<number>;
    tags: FieldType<readonly (string | null)[]>;
    enabled: FieldType<boolean>;
    user: FieldType<ObjectRef<'User'>>;
  };
  User: { name: FieldType<string>; nickname: FieldType<string | null> };
};
const sdl = `
  type Query { item: Item }
  type Item { id: ID! label: String amount: Int! tags: [String]! enabled: Boolean! user: User! }
  type User { name: String! nickname: String }
`;
const resource = createSchema<Model>(sdl).field('item');
const definition = resource.select({
  label: { as: 'title' },
  amount: true,
  tags: true,
  user: { select: { name: true } },
});
const scope = { source: 'typed', scope: 'session' };
const client = createGraphQLClient({ endpoint: 'http://localhost/graphql' });
const handle = client.watch(definition.bind({}, scope));
// @ts-expect-error Result types come from the definition, not an unchecked caller-supplied result.
client.watch<{ invented: string }>(definition.bind({}, scope));
const snapshot = handle.getSnapshot();
const data = snapshot.records?.[0]?.data;
const title: string | null | undefined = data?.title;
const amount: number | undefined = data?.amount;
const name: string | undefined = data?.user?.name;
const tags: readonly (string | null)[] | undefined = data?.tags;
const projected: SnapshotData<ResultOf<typeof definition>> | undefined = data;
void [title, amount, name, tags, projected];
declare const declaredResult: ResultOf<typeof definition>;
const completeDeclaredAmount: number = declaredResult.amount;
const completeDeclaredName: string = declaredResult.user.name;
void [completeDeclaredAmount, completeDeclaredName];
// @ts-expect-error An alias replaces its canonical result key.
data?.label;
// @ts-expect-error Selecting identity for reconciliation does not implicitly expose it in data.
data?.id;
// @ts-expect-error Unselected nested fields are not part of the result projection.
data?.user?.nickname;
// @ts-expect-error Runtime selected values can be missing during acquisition or after partial failure.
const requiredAmount: number = snapshot.records![0]!.data.amount;
// @ts-expect-error Non-null selected object branches may be null or missing after structural failure.
const requiredUserName: string = snapshot.records![0]!.data.user.name;
if (data) {
  // @ts-expect-error Root projected data is immutable.
  data.amount = 1;
  // @ts-expect-error Selected array values are immutable.
  data.tags?.push('changed');
}
void [requiredAmount, requiredUserName];
void handle.refresh('title');
void handle.refresh('user.name');
// @ts-expect-error Typed data must not widen allowed refresh paths.
void handle.refresh('label');
const oldHandle: QueryHandle<
  'title' | 'amount' | 'tags' | 'user' | 'user.name'
> = handle;
void oldHandle;

declare const flag: boolean;
const conditional = resource.select({
  amount: true,
  ...(flag ? { label: { as: 'title' as const } } : {}),
});
const conditionalData = client.watch(conditional.bind({}, scope)).getSnapshot()
  .records?.[0]?.data;
const optionalTitle: string | null | undefined = conditionalData?.title;
// @ts-expect-error Conditional selections remain optional.
const conditionalRequired: string | null = conditionalData!.title;
void [optionalTitle, conditionalRequired];
const aliases = resource.select({
  label: { as: flag ? ('first' as const) : ('second' as const) },
});
const aliasData = client.watch(aliases.bind({}, scope)).getSnapshot()
  .records?.[0]?.data;
const possibleFirst: string | null | undefined = aliasData?.first;
const possibleSecond: string | null | undefined = aliasData?.second;
void [possibleFirst, possibleSecond];
// @ts-expect-error Only one conditional alias is selected at runtime.
const requiredFirst: string | null = aliasData!.first;
void requiredFirst;
const alternative = resource.select(flag ? { label: true } : { amount: true });
const alternativeData = client.watch(alternative.bind({}, scope)).getSnapshot()
  .records?.[0]?.data;
if (alternativeData && 'label' in alternativeData) {
  const alternativeLabel: string | null | undefined = alternativeData.label;
  // @ts-expect-error A conditional selection does not promise the other alternative's fields.
  alternativeData.amount;
  void alternativeLabel;
}

declare const broad: Selection<Model, 'Item'>;
const broadData = client
  .watch(resource.select(broad).bind({}, scope))
  .getSnapshot().records?.[0]?.data;
// @ts-expect-error A broad optional selection cannot promise a requested scalar is present.
const broadAmount: number = broadData!.amount;
void broadAmount;
const dynamic = client.watch(
  createSchema(sdl).field('item').select({ amount: true }).bind({}, scope),
);
const dynamicData: InputObject | undefined =
  dynamic.getSnapshot().records?.[0]?.data;
const arbitrary: InputValue | undefined = dynamicData?.['notKnownStatically'];
// @ts-expect-error Dynamic SDL names do not provide compile-time scalar guarantees.
const dynamicAmount: number = dynamicData!['amount'];
// @ts-expect-error Dynamic GraphQL handles cannot acquire inferred scalar types through assignment.
const typedDynamic: QueryHandle<string, { amount: number }> = dynamic;
// @ts-expect-error Optional-only typed expectations also require a selected model.
const optionalDynamic: QueryHandle<string, { amount?: number }> = dynamic;
void [arbitrary, dynamicAmount, typedDynamic, optionalDynamic];
const bound = definition.bind({}, scope);
const withoutWitness = client.watch({ asSource: bound.asSource.bind(bound) });
const genericData: InputObject | undefined =
  withoutWitness.getSnapshot().records?.[0]?.data;
const genericAmount: InputValue | undefined = genericData?.['amount'];
// @ts-expect-error A source without a result witness has no guaranteed field scalar types.
const assumedAmount: number = genericData!['amount'];
// @ts-expect-error A custom definition without a result witness stays generic during assignment.
const typedWithoutWitness: QueryHandle<string, { amount: number }> =
  withoutWitness;
void [genericAmount, assumedAmount, typedWithoutWitness];

import { InjectionToken, type Injector } from '@angular/core';
import type { QueryHandle } from '@tandrove/core';
import {
  injectStateQuery,
  provideTandroveClient,
  tandroveSignal,
  type StateQuery,
  type StateQueryState,
} from '../src/public-api.js';
import {
  createSchema,
  type GraphQLClient,
  type FieldType,
  type ObjectRef,
  type ResultOf,
} from '@tandrove/graphql';

interface Client {
  watch(id: string): QueryHandle<'name' | 'user.name'>;
  dispose(): void;
}
const token = new InjectionToken<Client>('typed client');
declare const client: Client;
declare const injector: Injector;
provideTandroveClient(token, () => client);
// @ts-expect-error the factory must return the token's client type
provideTandroveClient(token, () => ({ dispose() {} }));
const query = injectStateQuery(
  () => 'A',
  (id) => client.watch(id),
  { injector },
);
void query.invalidate('name');
void query.refresh('user.name');
const stopPolling: () => void = query.poll({
  target: 'user.name',
  everyMs: 250,
});
stopPolling();
query.poll({ everyMs: false });
// @ts-expect-error polling preserves the query's allowed field targets
query.poll({ target: 'missing', everyMs: 250 });
// @ts-expect-error intervals have explicit numeric millisecond units
query.poll({ target: 'name', everyMs: '250ms' });
// @ts-expect-error target inference must survive the Angular wrapper
void query.invalidate('missing');
// @ts-expect-error state is a readonly signal
query.state.set({ status: 'pending' });
const state = query.state();
if (state.status === 'active') {
  const address: string = state.stateAddress;
  const fetching: boolean = state.snapshot.fetching;
  void address;
  void fetching;
}

type Model = {
  Query: { item: FieldType<ObjectRef<'Item'>, { id: string }> };
  Item: {
    name: FieldType<string>;
    user: FieldType<ObjectRef<'User'> | null>;
    tags: FieldType<readonly (string | null)[]>;
  };
  User: { name: FieldType<string> };
};
declare const graphql: GraphQLClient;
const definition = createSchema<Model>(
  'type Query { item(id: ID!): Item! } type Item { name: String!, user: User, tags: [String]! } type User { name: String! }',
)
  .field('item')
  .select({
    name: { as: 'label' },
    user: { select: { name: true } },
    tags: true,
  });
const gqlQuery = injectStateQuery(
  () =>
    definition.bind({ item: { id: '1' } }, { source: 'fixture', scope: 'A' }),
  (bound) => graphql.watch(bound),
  { injector },
);
void gqlQuery.invalidate('label');
gqlQuery.poll({ target: 'label', everyMs: 100 });
// @ts-expect-error polling uses the selected alias, not its canonical field name
gqlQuery.poll({ target: 'name', everyMs: 100 });
// @ts-expect-error canonical field is not the selected alias
void gqlQuery.invalidate('name');
// @ts-expect-error GraphQL required arguments remain checked
definition.bind({}, { source: 'fixture', scope: 'A' });

const typedQuery: StateQuery<
  'label' | 'user' | 'user.name' | 'tags',
  ResultOf<typeof definition>
> = gqlQuery;
const typedState: StateQueryState<ResultOf<typeof definition>> =
  typedQuery.state();
const legacyQuery: StateQuery = typedQuery;
const legacyState: StateQueryState = typedState;
void legacyQuery;
void legacyState;
declare const dynamicState: StateQueryState;
declare const dynamicQuery: StateQuery<'label'>;
declare const unknownQuery: StateQuery<'label', unknown>;
// @ts-expect-error dynamic state cannot invent a specific optional-only selected result
const inventedState: StateQueryState<{ readonly label?: string }> =
  dynamicState;
// @ts-expect-error dynamic queries cannot invent a specific optional-only selected result
const inventedQuery: StateQuery<'label', { readonly label?: string }> =
  dynamicQuery;
// @ts-expect-error unknown result models cannot invent a specific optional-only result
const inventedUnknown: StateQuery<'label', { readonly label?: string }> =
  unknownQuery;
void inventedState;
void inventedQuery;
void inventedUnknown;
if (typedState.status === 'active') {
  const data = typedState.snapshot.records?.[0]?.data;
  const label: string | undefined = data?.label;
  const nested: string | undefined = data?.user?.name;
  const tags: readonly (string | null)[] | undefined = data?.tags;
  void label;
  void nested;
  void tags;
  // @ts-expect-error selected values are not guaranteed to have arrived
  const completeLabel: string = data?.label;
  void completeLabel;
  // @ts-expect-error canonical name is hidden by the selected alias
  data?.name;
  // @ts-expect-error undeclared fields are not available
  data?.missing;
  // @ts-expect-error selected nested fields may be absent or structurally null
  data?.user.name;
  if (data) {
    // @ts-expect-error field snapshots stay readonly
    data.label = 'local draft';
    // @ts-expect-error scalar arrays stay readonly
    data.tags?.push('local draft');
    if (data.user) {
      // @ts-expect-error nested fields stay readonly
      data.user.name = 'local draft';
    }
  }
}
const observed = tandroveSignal(
  graphql.watch(
    definition.bind({ item: { id: '1' } }, { source: 'fixture', scope: 'A' }),
  ),
);
const observedLabel: string | undefined = observed().records?.[0]?.data.label;
void observedLabel;
// @ts-expect-error the non-owning signal bridge preserves selected keys as well
observed().records?.[0]?.data.missing;

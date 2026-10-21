import { InjectionToken, type Injector } from '@angular/core';
import type { QueryHandle } from '@tandrove/core';
import { injectStateQuery, provideTandroveClient } from '../src/public-api.js';
import {
  createSchema,
  type GraphQLClient,
  type FieldType,
  type ObjectRef,
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
  Item: { name: FieldType<string> };
};
declare const graphql: GraphQLClient;
const definition = createSchema<Model>(
  'type Query { item(id: ID!): Item! } type Item { name: String! }',
)
  .field('item')
  .select({ name: { as: 'label' } });
const gqlQuery = injectStateQuery(
  () =>
    definition.bind({ item: { id: '1' } }, { source: 'fixture', scope: 'A' }),
  (bound) => graphql.watch(bound),
  { injector },
);
void gqlQuery.invalidate('label');
// @ts-expect-error canonical field is not the selected alias
void gqlQuery.invalidate('name');
// @ts-expect-error GraphQL required arguments remain checked
definition.bind({}, { source: 'fixture', scope: 'A' });

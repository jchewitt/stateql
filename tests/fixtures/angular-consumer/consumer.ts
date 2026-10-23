import { Component, inject, InjectionToken } from '@angular/core';
import {
  AcquisitionClient,
  resourceAddress,
  type StoreReader,
  type QueryHandle,
} from '@tandrove/core';
import {
  tandroveSignal,
  injectStateQuery,
  provideTandroveClient,
  type StateQuery,
  type StateQueryState,
} from '@tandrove/angular';

const CLIENT = new InjectionToken<AcquisitionClient>('packed client');
const authority = {}; // Component instances share one backend and canonical scopes.
export const providers = provideTandroveClient(
  CLIENT,
  () => new AcquisitionClient(),
);

const reader: StoreReader<Readonly<{ value: string }>> = {
  getSnapshot: () => Object.freeze({ value: 'packaged snapshot' }),
  subscribe: () => () => {},
};

@Component({
  selector: 'packed-consumer',
  standalone: true,
  template:
    '<span>{{ snapshot().value }}</span>@if (query.state(); as current) { @if (current.status === "active") { <span>{{ current.snapshot.fetching }}</span> } }',
})
export class Consumer {
  readonly snapshot = tandroveSignal(reader);
  private readonly client = inject(CLIENT);
  readonly query = injectStateQuery(
    () => 'A',
    (value) =>
      this.client.watch({
        authority,
        stateAddress: resourceAddress({ source: 'packed', scope: value }, [
          { name: 'item', arguments: {} },
        ]),
        selection: [
          { name: 'name', responseName: 'name', arguments: {}, children: [] },
        ],
        read: async () => [],
      }),
  );
}

declare const consumer: Consumer;
// @ts-expect-error a snapshot signal cannot be written to
consumer.snapshot.set({ value: 'draft' });
// @ts-expect-error snapshot shape must be preserved through the packed declarations
consumer.snapshot().missing;
// @ts-expect-error immutable source remains immutable
consumer.snapshot().value = 'draft';
declare const narrow: QueryHandle<'name'>;
const typed = injectStateQuery(
  () => 'A',
  () => narrow,
);
void typed.invalidate('name');
const stopPolling: () => void = typed.poll({ target: 'name', everyMs: 100 });
stopPolling();
// @ts-expect-error polling target literals must survive packed declarations
typed.poll({ target: 'missing', everyMs: 100 });
// @ts-expect-error target literals must survive packed declarations
void typed.invalidate('missing');
// @ts-expect-error token type controls the provider's factory
provideTandroveClient(CLIENT, () => ({ dispose() {} }));

declare const projected: QueryHandle<
  'label' | 'owner' | 'owner.name',
  {
    readonly label: string;
    readonly owner: { readonly name: string } | null;
  }
>;
const projectedQuery = injectStateQuery(
  () => 'A',
  () => projected,
);
const projectedState = projectedQuery.state();
const legacyQuery: StateQuery = projectedQuery;
const legacyState: StateQueryState = projectedState;
void legacyQuery;
void legacyState;
declare const dynamicQuery: StateQuery<'label'>;
declare const dynamicState: StateQueryState;
// @ts-expect-error installed declarations must not promote raw queries to an optional-only model
const inventedQuery: StateQuery<'label', { readonly label?: string }> =
  dynamicQuery;
// @ts-expect-error installed declarations must not promote raw state to an optional-only model
const inventedState: StateQueryState<{ readonly label?: string }> =
  dynamicState;
void inventedQuery;
void inventedState;
if (projectedState.status === 'active') {
  const data = projectedState.snapshot.records?.[0]?.data;
  const label: string | undefined = data?.label;
  const owner: string | undefined = data?.owner?.name;
  void label;
  void owner;
  // @ts-expect-error packed declarations retain missing-field handling
  const required: string = data?.label;
  void required;
  // @ts-expect-error packed declarations retain selected shape
  data?.missing;
  if (data?.owner) {
    // @ts-expect-error nested snapshots stay readonly after package installation
    data.owner.name = 'draft';
  }
}
const projectedSignal = tandroveSignal(projected);
const label: string | undefined = projectedSignal().records?.[0]?.data.label;
void label;
// @ts-expect-error the installed non-owning bridge retains selected shape
projectedSignal().records?.[0]?.data.missing;

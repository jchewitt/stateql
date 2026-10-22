import {
  createProviderToken,
  createProviderScope,
  provide,
  createAcquisitionSourceToken,
  type AcquisitionSource,
  AcquisitionClient,
} from '../src/index.js';
const number = createProviderToken(
  'number',
  (value): value is number => typeof value === 'number',
);
const scope = createProviderScope([provide(number, { useValue: 1 })]);
const ready: number = scope.get(number);
const pending: Promise<number> = scope.resolve(number);
void ready;
void pending;
provide(number, {
  useFactory: async ({ signal, onCleanup }) => {
    const cancelled: boolean = signal.aborted;
    onCleanup(async () => {});
    return cancelled ? 0 : 1;
  },
  ownership: 'owned',
  dispose: (value) => {
    const typed: number = value;
    void typed;
  },
});
// @ts-expect-error Token type cannot be widened to accommodate the wrong value.
provide(number, { useValue: 'wrong' });
// @ts-expect-error Factory values must satisfy the token type.
provide(number, { useFactory: async () => 'wrong' });
// @ts-expect-error Ownership must have an explicit release callback.
provide(number, { useValue: 1, ownership: 'owned' });
// @ts-expect-error Borrowed provider values cannot be disposed by the scope.
provide(number, { useValue: 1, ownership: 'borrowed', dispose: () => {} });
// @ts-expect-error get() preserves the token type.
const wrong: string = scope.get(number);
void wrong;
const source = createAcquisitionSourceToken();
declare const supplied: AcquisitionSource;
const sources = createProviderScope([provide(source, { useValue: supplied })]);
const result: AcquisitionSource = sources.get(source);
void result;
const client = new AcquisitionClient({
  providerScope: sources,
  providers: { acquisition: source },
  resourceGroups: { disabled: { providers: { acquisition: false } } },
});
client.watch(
  { stateAddress: supplied.stateAddress, selection: supplied.selection },
  { group: 'disabled', providers: { acquisition: source } },
);
new AcquisitionClient({
  providerScope: scope,
  // @ts-expect-error Capability assignment preserves source type.
  providers: { acquisition: number },
});
// @ts-expect-error Unimplemented capabilities are not configurable.
client.watch(supplied, { providers: { stream: false } });

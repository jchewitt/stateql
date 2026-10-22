# Provider registration and ownership

B4 adds optional provider scopes, validated tokens and explicit resource ownership. It is implemented in this checkout and queued in the `provider-ownership` Changeset; alpha.5 and earlier do not include these APIs. B5 adds [global/group/resource capability assignment](CONFIGURATION.md), also queued for a batched release. Existing `createGraphQLClient({ endpoint })` and Angular client construction remain synchronous and need no registry.

## Register, resolve, then use an ordinary client

```js
import { createProviderScope, provide } from '@tandrove/core';
import {
  createGraphQLTransportToken,
  createGraphQLClient,
  httpTransport,
} from '@tandrove/graphql';

const http = createGraphQLTransportToken('billing HTTP');
const providers = createProviderScope([
  provide(http, {
    useFactory: async () =>
      httpTransport({ endpoint: 'https://example.com/graphql' }),
  }),
]);
let client;
try {
  const transport = await providers.resolve(http);
  client = createGraphQLClient({ transport });
  // Use client.watch(boundDefinition) normally.
} finally {
  client?.dispose();
  await providers.dispose();
}
```

`createProviderToken(description, validator)` creates a unique token with an application-supplied capability validator. TypeScript infers its value type from the validator's type predicate; JavaScript uses the same runtime. `createGraphQLTransportToken()` validates callable transports, and core's `createAcquisitionSourceToken()` validates the existing source capability and selection. They do not certify behavior: responses still pass ordinary GraphQL decoding and core atomic validation. Official HTTP and application-owned implementations use the same boundary.

`provide(token, { useValue })` validates a supplied instance immediately. `provide(token, { useFactory })` captures a synchronous or asynchronous factory; its result is validated before becoming ready. Specify exactly one. Token descriptions are diagnostic labels, not identities, cache keys or authority scopes. Registrations and options are captured; infrastructure values remain application objects and are not frozen. Keep their capability methods valid throughout use. Provider values must not be promises/thenables: use a factory for asynchronous initialization and return a nonthenable capability value.

`createProviderScope(registrations)` creates one explicit runtime owner. Duplicate tokens and duplicate owned values are rejected before ownership transfers. Supplied values are immediately available through `get(token)`. Factories are lazy: `get()` never starts them and throws until ready. `resolve(token)` always returns a promise, shares pending initialization and reuses its result. Failures are memoized, including synchronous factory exceptions; resolution does not implicitly retry. During failed initialization cleanup, `get()` throws the original failure; after cleanup it includes any cleanup errors as described below.

The scope has no process-global instance cache, dependency resolver, aliases, implicit dependency graph or registration-to-resource assignment. Factories receive only cancellation and cleanup capabilities. Compose dependencies explicitly during application bootstrap; factories and cleanup callbacks must not await their own resolution or their enclosing scope's disposal. Different provider scopes are independent. Never give two runtimes ownership of the same external resource, including by reusing an owned instance registration in multiple scopes.

## Ownership and cleanup

Both supplied values and factory results default to `ownership: 'borrowed'`. The scope never guesses ownership by calling a value's `.dispose()` method. Stateless HTTP transport functions need no release callback. For a resource the scope should close, explicitly provide both `ownership: 'owned'` and `dispose(value)`:

```js
const registration = provide(connectionToken, {
  ownership: 'owned',
  dispose: (connection) => connection.close(),
  useFactory: async ({ signal, onCleanup }) => {
    const listener = installPrivateListener();
    onCleanup(() => listener.remove());
    return await openConnection(signal);
  },
});
```

This illustrative factory assumes application-defined functions and a validated connection token. `signal` is core's portable `CancellationSignal`, not a DOM AbortSignal; adapters bridge it to native cancellation if needed. It aborts on initialization failure or scope disposal. `onCleanup()` records private allocations made during initialization, including resources allocated before a failing await. These registrations are released on failure or scope disposal even when the returned value is borrowed. Do not also register the returned connection's close operation when `dispose(value)` already owns it.

Owned supplied instances transfer at successful scope creation, even if never resolved. A structural construction failure transfers nothing. Failed `provide()` validation also transfers nothing. Owned factory results transfer when returned, including late or invalid results; the explicit disposer must tolerate its own factory's output. Private allocations that never reach a return statement must be registered with `onCleanup()` or cleaned by the factory. Two owning registrations cannot claim the same value within one scope; a duplicate factory claim fails without closing the first owner's value.

On normal disposal, each provider releases its returned owned value, then its private callbacks in reverse registration order. Independent providers have no dependency-order guarantee. Cleanup continues after exceptions, and disposal rejects with an `AggregateError` containing cleanup failures. Initialization failure also cancels that provider and drains its private allocations; if cleanup fails, resolution rejects with an `AggregateError` preserving the original initialization error as `cause` and the first error. Other providers remain usable. Wrap application bootstrap in `try/finally` to dispose the whole scope after unsuccessful setup.

`dispose()` seals the scope synchronously before invoking user code, rejects pending consumers, signals cancellation and releases currently known allocations. Repeated calls return the same promise and never repeat cleanup. No late factory result becomes available: late owned values are released, late borrowed values are left to their owner, and late rejections are consumed. A still-pending factory may register additional cleanup after cancellation; it is scheduled for release. Late allocations/results necessarily clean after already-released allocations. Once initialization settles, its context cannot register new cleanup.

Await disposal to know all initialization and asynchronous cleanup have settled. An uncooperative factory or cleanup callback that never settles can keep that promise pending; core cannot forcibly terminate user code. Factories should observe cancellation and bound their own external initialization. Pending consumers reject promptly even in that case. Internal value/configuration references are released after cleanup. Objects or resolution promises already held by application code remain ordinary references; disposal cannot revoke them.

## Client and framework boundaries

Dispose clients before their provider scope. A query handle's disposal, inactive-cache eviction, or one client's disposal does not close a shared provider. A scope does not discover or dispose consumers constructed outside it. Multiple clients may borrow a resolved transport, but their caches remain separate. Source addresses and tenant/schema scopes govern state sharing independently of provider labels.

For Angular, resolve async providers during application bootstrap, then give ready dependencies to the existing synchronous `provideTandroveClient()` factory. That factory owns the client; the provider scope owns only infrastructure explicitly assigned to it. Do not give both Angular and the scope ownership of the same client. A dedicated async framework lifecycle bridge remains separate work; no server package or DI container is required.

Run `pnpm demo:providers` after `pnpm build`. The native JavaScript example registers a GraphQL transport factory and borrowed custom whole-resource source, assigns them through global/group/resource configuration, shares initialization and cached reads, and tears down private allocations. Installed-package acceptance executes it and checks its editor types. Integration tests also exercise the official HTTP transport against an actual local HTTP server and verify malformed custom responses still fail the normal validation boundary.

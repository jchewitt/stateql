# Angular package foundation

P4.1 introduces the private `@jchewitt/stateql-angular` package and a small observation bridge. P4.2 will add client providers, owned query handles, reactive argument replacement, and their lifecycle integration. The billing app still runs the Apollo baseline; StateQL views and forms arrive in P4.3/P4.4.

```ts
import { stateqlSignal } from '@jchewitt/stateql-angular';

// During component/service construction, with a reader owned by the caller:
const snapshot = stateqlSignal(queryHandle);
// snapshot() returns the current immutable snapshot.
```

`stateqlSignal(reader, options?)` accepts core's portable `StoreReader<T>` and returns a readonly Angular `Signal<T>`. The reader supplies stable immutable snapshots. The adapter reads synchronously, subscribes, and rechecks to close a possible read/subscribe gap. It adds no fetching, caching, polling, retries, invalidation, or writable state API.

By default, it uses the current Angular injection context's `DestroyRef`. An explicit `{ destroyRef }` allows use outside an injection context. Construct the bridge once per intended lifetime, outside `computed` or effects; reactive-context construction is rejected to avoid accumulating subscriptions. An already-destroyed scope also rejects.

Destroying that scope unsubscribes and leaves the signal at its last observed snapshot. It does **not** dispose the reader, query handle, or client. The caller retains ownership of those resources. A service created in the application injector naturally observes for that application's lifetime, not for each consuming component's lifetime. The readonly signal prevents assigning a different snapshot through the adapter; it does not deep-freeze arbitrary third-party reader values. StateQL's own snapshots already enforce immutability.

The package has Angular core and StateQL core peers so the host supplies the shared runtime. It imports no GraphQL or forms implementation. Angular 21.2.25 is the tested baseline, and the peer range stays within Angular 21. TypeScript declarations preserve the source snapshot type; the runtime remains JavaScript.

## Packaging and verification

Build with `pnpm build` or `pnpm --filter @jchewitt/stateql-angular build` after building core. The build uses ng-packagr with Angular partial compilation and produces the Angular Package Format under `packages/angular/dist`. The workspace package points to that output; the build removes those workspace-only paths from the generated package manifest, retaining ng-packagr's exports, module and declaration entries.

Pack the generated `dist` directory, not the source package directory. The package remains private, has no publication workflow enabled, and is not yet a supported release.

`pnpm check` runs lifecycle/type tests and packs the real APF output. The package check installs it and core into a temporary consumer outside the workspace, verifies native ESM observation/destruction, and compiles a standalone Angular component and its template with `ngc`. It checks declarations, package contents, peers, license, and removal of stale build output. There are no decorated library declarations yet; the partial compiler setting is in place for later DI APIs.

The build follows [Angular's package format](https://angular.dev/tools/libraries/angular-package-format) and its [library compilation guidance](https://angular.dev/tools/libraries/creating-libraries). Lifetime cleanup uses the public [DestroyRef API](https://angular.dev/api/core/DestroyRef).

## Forms boundary

The signal exposes server snapshots. Editable controls hold separate local drafts; reading a signal never implies sending a command. The [forms contract](FORMS.md) specifies pristine-field refresh, conflict detection, explicit saves, edits during save, and future stream acknowledgements. Those behaviors are planned for P4.4, not implemented by this observation bridge.

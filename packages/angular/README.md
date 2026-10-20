# StateQL Angular integration

Private experimental Angular Package Format library. `stateqlSignal(reader, { destroyRef? })` observes a StateQL `StoreReader<T>` as a readonly Angular signal. It uses the current injection lifetime by default and unsubscribes on destruction without disposing the reader or shared client.

The adapter observes the shared core runtime without duplicating fetching, retries, caching, or invalidation. Construct it once outside reactive computations. Form edits remain separate local drafts; observing server state never sends a write.

Build through ng-packagr in partial compilation mode and pack the generated `dist` directory. Angular core and StateQL core are peers; the tested Angular baseline is 21.2.25. The package stays private and has no supported npm release. DI providers, owned handles, reactive argument changes, StateQL demo views and form bindings remain later P4 tasks.

See the [Angular guide](https://github.com/jchewitt/stateql/blob/main/docs/ANGULAR.md) and [forms contract](https://github.com/jchewitt/stateql/blob/main/docs/FORMS.md).

# StateQL core

Experimental foundation for StateQL's framework-independent runtime.

This scaffold currently exports only `StoreReader`, `Unsubscribe`, and `Disposable` TypeScript contracts. The query engine, cache, and invalidation API are not implemented. There is no supported npm release yet.

The observation interface has no Angular, React, RxJS, GraphQL, DOM, or Node dependencies. Runtime snapshots must be immutable; TypeScript callers supply an immutable snapshot type. Framework adapters will subscribe to this same runtime rather than maintain a separate cache.

See the [project plan](https://github.com/jchewitt/stateql/blob/main/PLAN.md) and [task list](https://github.com/jchewitt/stateql/blob/main/docs/TASKS.md).

# StateQL core

Experimental foundation for StateQL's framework-independent runtime.

Exports `StoreReader`, `Unsubscribe`, and `Disposable` contracts plus portable canonical addresses and immutable selection composition. Resource addresses include source, scope, canonical path, and arguments; selections and aliases do not change resource identity. Field addresses include canonical field arguments and optional record identity. The cache and invalidation runtime are not implemented. There is no supported npm release yet.

The observation interface has no Angular, React, RxJS, GraphQL, DOM, or Node dependencies. Runtime snapshots must be immutable; TypeScript callers supply an immutable snapshot type. Framework adapters will subscribe to this same runtime rather than maintain a separate cache.

See the [project plan](https://github.com/jchewitt/stateql/blob/main/PLAN.md) and [task list](https://github.com/jchewitt/stateql/blob/main/docs/TASKS.md).

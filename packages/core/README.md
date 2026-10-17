# StateQL core

Experimental foundation for StateQL's framework-independent runtime.

Exports observation contracts, portable canonical addresses, immutable selection composition, and a provisional `StateStore`. The store supports shared records, atomic commits, consumer projections, stable snapshots, subscriptions, and disposal. Automatic fetching, response reconciliation, and invalidation scheduling are still planned. There is no supported npm release yet.

The observation interface has no Angular, React, RxJS, GraphQL, DOM, or Node dependencies. Runtime snapshots must be immutable; TypeScript callers supply an immutable snapshot type. Framework adapters will subscribe to this same runtime rather than maintain a separate cache.

See the [store guide](https://github.com/jchewitt/stateql/blob/main/docs/STORE.md) for commit semantics and the boundary between storage and request coordination.

See the [project plan](https://github.com/jchewitt/stateql/blob/main/PLAN.md) and [task list](https://github.com/jchewitt/stateql/blob/main/docs/TASKS.md).

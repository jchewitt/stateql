# StateQL core

Experimental foundation for StateQL's framework-independent runtime.

Exports observation contracts, portable canonical addresses, immutable selection composition, a provisional `StateStore`, and `AcquisitionClient`. Acquisition reuses shared fresh fields and asks a source for missing selections. Query handles support field/branch invalidation, mark-only invalidation, forced refresh, and explicit keyed-list membership refresh. Partial-error reconciliation, concurrent refresh scheduling, cancellation, and retries are still planned. There is no supported npm release yet.

The observation interface has no Angular, React, RxJS, GraphQL, DOM, or Node dependencies. Runtime snapshots must be immutable; TypeScript callers supply an immutable snapshot type. Framework adapters will subscribe to this same runtime rather than maintain a separate cache.

See the [store guide](https://github.com/jchewitt/stateql/blob/main/docs/STORE.md) for commit semantics and the boundary between storage and request coordination.

See the [project plan](https://github.com/jchewitt/stateql/blob/main/PLAN.md) and [task list](https://github.com/jchewitt/stateql/blob/main/docs/TASKS.md).

# StateQL core

Experimental foundation for StateQL's framework-independent runtime.

Exports observation contracts, portable canonical addresses, immutable selection composition, a provisional `StateStore`, and `AcquisitionClient`. Acquisition reuses shared fresh fields and asks a source for missing selections. Query handles support field/branch invalidation, mark-only invalidation, forced refresh, and explicit keyed-list membership refresh. Decoded partial failures retain successful fields, while structural nulls discard obsolete descendants. Snapshots distinguish unknown, null, and populated/empty resources and expose shared field/resource errors. Concurrent acquisition deduplicates identical work, filters superseded writes using local generations, and cancels work after its final interested owner leaves. Retries are still planned. There is no supported npm release yet.

The observation interface has no Angular, React, RxJS, GraphQL, DOM, or Node dependencies. Runtime snapshots must be immutable; TypeScript callers supply an immutable snapshot type. Framework adapters will subscribe to this same runtime rather than maintain a separate cache.

See the [store guide](https://github.com/jchewitt/stateql/blob/main/docs/STORE.md) for commit semantics and the boundary between storage and request coordination.

The [concurrency contract](https://github.com/jchewitt/stateql/blob/main/docs/CONCURRENCY.md) describes ownership, cancellation signals, and `AcquisitionSupersededError`. Local request ordering does not establish server revision ordering.

See the [project plan](https://github.com/jchewitt/stateql/blob/main/PLAN.md) and [task list](https://github.com/jchewitt/stateql/blob/main/docs/TASKS.md).

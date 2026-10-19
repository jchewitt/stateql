import {
  canonicalInput,
  freezeFields,
  mergeFields,
  narrowFields,
  selectFieldPath,
  snapshotInput,
  type ResolvedField,
} from './definition.js';
import { StateStore } from './state-store.js';
import { leafPaths, staleChanges } from './acquisition-coverage.js';
import { reconcileAcquisition } from './acquisition-reconciliation.js';
import type {
  FieldPath,
  RecordIdentity,
  StateSnapshot,
  StateView,
} from './state-types.js';

export type AcquiredField =
  | {
      readonly kind: 'write';
      readonly path: FieldPath;
      readonly value: import('./definition.js').InputValue;
    }
  | {
      readonly kind: 'object';
      readonly path: FieldPath;
      readonly identity?: RecordIdentity;
    };
export interface AcquiredRecord {
  readonly identity: RecordIdentity;
  readonly fields: readonly AcquiredField[];
}
/** Provisional source boundary: decode protocol responses before returning records. */
export interface AcquisitionSource {
  readonly stateAddress: string;
  readonly selection: readonly ResolvedField[];
  /** Opts into identity-based list reconciliation and explicit membership refresh. */
  readonly collection?: boolean;
  /** Optional broader read coverage (for example, a whole-resource backend).
   * Must contain the requested fields and remain inside this source's selection.
   * Extra fetched values are validated but never committed as ordinary field writes. */
  fetchSelection?(
    requested: readonly ResolvedField[],
  ): readonly ResolvedField[];
  read(selection: readonly ResolvedField[]): Promise<readonly AcquiredRecord[]>;
}
export interface InvalidateOptions {
  readonly refetch?: 'active' | 'none';
}
export interface QuerySnapshot extends StateSnapshot {
  readonly error: string | undefined;
}
export interface QueryHandle<Target extends string = string> extends Omit<
  StateView,
  'getSnapshot'
> {
  getSnapshot(): QuerySnapshot;
  /** Settles after this handle's automatic first acquisition. */
  readonly ready: Promise<void>;
  /** Reuses fresh fields; requests only missing/stale/error fields. Also retries a failed acquisition. */
  ensure(): Promise<void>;
  /** Marks the selected fields stale immediately. Active handles refetch by default. */
  invalidate(target?: Target, options?: InvalidateOptions): Promise<void>;
  /** Forces a selected read without first marking cached values stale. */
  refresh(target?: Target): Promise<void>;
  /** Replace list membership/order using this handle's entire declared selection. */
  refreshList(): Promise<void>;
}
interface Scope {
  tail: Promise<void>;
  readonly handles: Set<Handle>;
  /** Invalidations arriving after the current serialized read began. */
  pendingInvalidations?: FieldPath[];
}

function needed(view: StateView): readonly ResolvedField[] {
  const snapshot = view.getSnapshot();
  if (snapshot.records === undefined) return view.selection;
  let fields: readonly ResolvedField[] = [];
  for (const record of snapshot.records)
    for (const status of record.fields) {
      if (!status.present || status.stale || status.error !== undefined)
        fields = mergeFields(
          fields,
          selectFieldPath(view.selection, status.path),
        );
    }
  return fields;
}

class Handle {
  active = true;
  error: string | undefined;
  private snapshot: QuerySnapshot;
  private signature: string;
  private notifiedSignature: string;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  constructor(
    readonly view: StateView,
    private readonly onListenerError: (error: unknown) => void,
  ) {
    this.snapshot = Object.freeze({ ...view.getSnapshot(), error: undefined });
    this.signature = canonicalInput(this.snapshot);
    this.notifiedSignature = this.signature;
    this.unsubscribe = view.subscribe(() => this.publish());
  }
  publish(): void {
    if (!this.active) return;
    this.refreshSnapshot();
    if (this.signature === this.notifiedSignature) return;
    this.notifiedSignature = this.signature;
    for (const listener of [...this.listeners])
      if (this.active && this.listeners.has(listener)) {
        try {
          listener();
        } catch (error) {
          this.onListenerError(error);
        }
      }
  }
  private refreshSnapshot(): void {
    if (!this.active) return;
    const snapshot = Object.freeze({
      ...this.view.getSnapshot(),
      error: this.error,
    });
    const signature = canonicalInput(snapshot);
    if (signature === this.signature) return;
    this.signature = signature;
    this.snapshot = snapshot;
  }
  getSnapshot(): QuerySnapshot {
    this.refreshSnapshot();
    return this.snapshot;
  }
  subscribe(listener: () => void): () => void {
    if (!this.active) throw new Error('Query handle is disposed.');
    const registration = () => listener();
    this.listeners.add(registration);
    return () => {
      this.listeners.delete(registration);
    };
  }
  dispose(): void {
    if (!this.active) return;
    this.refreshSnapshot();
    this.active = false;
    this.unsubscribe();
    this.listeners.clear();
    this.view.dispose();
  }
}

/** Serialized acquisition and selective refresh over shared canonical state. */
export class AcquisitionClient {
  private readonly store = new StateStore();
  private readonly scopes = new Map<string, Scope>();
  private disposed = false;
  private request = 0;
  constructor(
    private readonly options: {
      readonly onListenerError?: (error: unknown) => void;
    } = {},
  ) {}
  watch(source: AcquisitionSource): QueryHandle {
    if (this.disposed) throw new Error('Client is disposed.');
    const selection = freezeFields(source.selection);
    const address = source.stateAddress;
    const read = source.read.bind(source);
    const fetchSelection = source.fetchSelection?.bind(source);
    const collection = source.collection === true;
    const view = this.store.watch(address, selection);
    let scope = this.scopes.get(address);
    if (!scope) {
      scope = { tail: Promise.resolve(), handles: new Set() };
      this.scopes.set(address, scope);
    }
    const current = scope;
    const handle = new Handle(view, (error) => {
      // Observer failure must never become a transport failure or trigger a retry.
      try {
        this.options.onListenerError?.(error);
      } catch {
        /* Reporting cannot disrupt acquisition. */
      }
    });
    current.handles.add(handle);
    const enqueue = (
      requested?: readonly ResolvedField[],
      replaceMembership = false,
    ): Promise<void> => {
      if (this.disposed || !handle.active)
        return Promise.reject(new Error('Query handle is disposed.'));
      const task = current.tail.then(async () => {
        if (this.disposed || !handle.active)
          throw new Error('Query handle is disposed.');
        const fields = requested ?? needed(view);
        handle.error = undefined;
        handle.publish();
        if (!fields.length) return;
        const requestId = String(++this.request);
        current.pendingInvalidations = [];
        try {
          // Keep requested, fetched, and commit coverage separate. Only the first
          // and third coincide today; broader backends may expand the second.
          const fetched = fetchSelection
            ? narrowFields(selection, fetchSelection(fields))
            : fields;
          narrowFields(fetched, fields);
          this.store.setFetching(address, requestId, fields, replaceMembership);
          if (this.disposed || !current.handles.size)
            throw new Error('Acquisition has no active owners.');
          const records = await read(fetched);
          if (this.disposed || !current.handles.size)
            throw new Error('Acquisition has no active owners.');
          // Snapshot and validate before committing; a source cannot alter data after return.
          const acquired = snapshotInput(
            records,
          ) as unknown as readonly AcquiredRecord[];
          if (!Array.isArray(acquired))
            throw new Error('Source must return records.');
          const result = reconcileAcquisition({
            acquired,
            known: view.getSnapshot().records,
            requested: fields,
            fetched,
            collection,
            replaceMembership,
            pendingInvalidations: current.pendingInvalidations,
          });
          this.store.commit(address, result.changes);
          if (result.incomplete) throw new Error(result.incomplete);
          if (!handle.active) throw new Error('Query handle is disposed.');
        } catch (error) {
          if (handle.active && !this.disposed) {
            handle.error =
              error instanceof Error ? error.message : String(error);
            handle.publish();
          }
          throw error;
        } finally {
          delete current.pendingInvalidations;
          if (!this.disposed) this.store.setFetching(address, requestId);
        }
      });
      current.tail = task.catch(() => {});
      return task;
    };
    const ensure = (): Promise<void> => enqueue();
    const targetFields = (target?: string): readonly ResolvedField[] => {
      if (this.disposed || !handle.active)
        throw new Error('Query handle is disposed.');
      return target === undefined
        ? selection
        : selectFieldPath(selection, target.split('.'));
    };
    const refresh = (target?: string): Promise<void> => {
      try {
        return enqueue(targetFields(target));
      } catch (error) {
        return Promise.reject(error);
      }
    };
    const refreshList = (): Promise<void> => {
      try {
        const fields = targetFields();
        if (!collection)
          throw new Error('refreshList requires a collection source.');
        return enqueue(fields, true);
      } catch (error) {
        return Promise.reject(error);
      }
    };
    const invalidate = (
      target?: string,
      options: InvalidateOptions = {},
    ): Promise<void> => {
      try {
        const fields = targetFields(target);
        if (
          options.refetch !== undefined &&
          options.refetch !== 'active' &&
          options.refetch !== 'none'
        )
          throw new Error('Unknown refetch policy.');
        const paths = leafPaths(fields);
        current.pendingInvalidations?.push(...paths);
        // Reserve queue order before notifying listeners, which may enqueue work.
        const task =
          options.refetch === 'none' ? Promise.resolve() : enqueue(fields);
        this.store.commit(
          address,
          staleChanges(view.getSnapshot().records ?? [], paths),
        );
        return task;
      } catch (error) {
        return Promise.reject(error);
      }
    };
    const ready = ensure();
    // Automatic acquisition errors remain observable through ready/snapshot without unhandled rejections.
    void ready.catch(() => {});
    return Object.freeze({
      stateAddress: address,
      selection,
      ready,
      ensure,
      invalidate,
      refresh,
      refreshList,
      getSnapshot: () => handle.getSnapshot(),
      subscribe: (listener: () => void) => handle.subscribe(listener),
      dispose: () => {
        handle.dispose();
        current.handles.delete(handle);
      },
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const scope of this.scopes.values()) {
      for (const handle of scope.handles) handle.dispose();
      scope.handles.clear();
    }
    this.scopes.clear();
    this.store.dispose();
  }
}

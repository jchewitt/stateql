import {
  canonicalInput,
  freezeFields,
  mergeFields,
  selectFieldPath,
  snapshotInput,
  type ResolvedField,
} from './definition.js';
import { StateStore } from './state-store.js';
import type {
  FieldPath,
  RecordIdentity,
  StateChange,
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
  read(selection: readonly ResolvedField[]): Promise<readonly AcquiredRecord[]>;
}
export interface QuerySnapshot extends StateSnapshot {
  readonly error: string | undefined;
}
export interface QueryHandle extends Omit<StateView, 'getSnapshot'> {
  getSnapshot(): QuerySnapshot;
  /** Settles after this handle's automatic first acquisition. */
  readonly ready: Promise<void>;
  /** Reuses fresh fields; requests only missing/stale/error fields. Also retries a failed acquisition. */
  ensure(): Promise<void>;
}
interface Scope {
  tail: Promise<void>;
  readonly handles: Set<Handle>;
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
function segmentEqual(a: FieldPath[number], b: FieldPath[number]): boolean {
  return (
    a.name === b.name &&
    canonicalInput(a.arguments) === canonicalInput(b.arguments)
  );
}
function covered(path: FieldPath, fields: readonly ResolvedField[]): boolean {
  const [first, ...rest] = path;
  if (!first) return false;
  const match = fields.find((field) => segmentEqual(first, field));
  return !!match && (!rest.length || covered(rest, match.children));
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

/** Serialized initial/missing-field acquisition. Explicit invalidation/concurrent refresh follows later. */
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
    const ensure = (): Promise<void> => {
      if (this.disposed || !handle.active)
        return Promise.reject(new Error('Query handle is disposed.'));
      const task = current.tail.then(async () => {
        if (this.disposed || !handle.active)
          throw new Error('Query handle is disposed.');
        const fields = needed(view);
        handle.error = undefined;
        handle.publish();
        if (!fields.length) return;
        const requestId = String(++this.request);
        this.store.setFetching(address, requestId, fields);
        try {
          const records = await read(fields);
          if (this.disposed || !current.handles.size)
            throw new Error('Acquisition has no active owners.');
          // Snapshot and validate before committing; a source cannot alter data after return.
          const acquired = snapshotInput(
            records,
          ) as unknown as readonly AcquiredRecord[];
          if (!Array.isArray(acquired))
            throw new Error('Source must return records.');
          const known = view.getSnapshot().records;
          const ids = acquired.map((record) => canonicalInput(record.identity));
          if (new Set(ids).size !== ids.length)
            throw new Error('Duplicate acquired identity.');
          if (known !== undefined) {
            const existing = new Set(
              known.map((record) => canonicalInput(record.identity)),
            );
            if (
              existing.size !== ids.length ||
              ids.some((id) => !existing.has(id))
            )
              throw new Error(
                'Membership changed during field acquisition; explicit list reconciliation is required.',
              );
          }
          const changes: StateChange[] =
            known === undefined
              ? [
                  {
                    kind: 'membership',
                    records: acquired.map((record) => record.identity),
                  },
                ]
              : [];
          for (const record of acquired)
            for (const field of record.fields) {
              if (
                (field.kind !== 'write' && field.kind !== 'object') ||
                !covered(field.path, fields)
              )
                throw new Error(
                  'Source returned a write outside requested coverage.',
                );
              changes.push({ ...field, record: record.identity });
            }
          this.store.commit(address, changes);
          if (handle.active && needed(view).length)
            throw new Error('Source omitted requested fields.');
          if (!handle.active) throw new Error('Query handle is disposed.');
        } catch (error) {
          if (handle.active && !this.disposed) {
            handle.error =
              error instanceof Error ? error.message : String(error);
            handle.publish();
          }
          throw error;
        } finally {
          if (!this.disposed) this.store.setFetching(address, requestId);
        }
      });
      current.tail = task.catch(() => {});
      return task;
    };
    const ready = ensure();
    // Automatic acquisition errors remain observable through ready/snapshot without unhandled rejections.
    void ready.catch(() => {});
    return Object.freeze({
      stateAddress: address,
      selection,
      ready,
      ensure,
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

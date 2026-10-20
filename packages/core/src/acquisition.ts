import {
  canonicalInput,
  freezeFields,
  selectFieldPath,
  type ResolvedField,
} from './definition.js';
import { StateStore } from './state-store.js';
import { leafPaths } from './acquisition-coverage.js';
import { AcquisitionScheduler } from './acquisition-scheduler.js';
import { ReadRetrier, type AcquisitionClientOptions } from './read-retry.js';
import {
  Cancellation,
  cancellable,
  type CancellationSignal,
} from './cancellation.js';
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
    }
  | {
      readonly kind: 'error';
      readonly path: FieldPath;
      readonly message: string;
      /** An object became null; discard descendants rather than retaining its old shape. */
      readonly structuralNull?: boolean;
    };
export interface AcquiredRecord {
  readonly identity: RecordIdentity;
  readonly fields: readonly AcquiredField[];
}
export interface AcquiredNull {
  readonly kind: 'null';
  readonly error?: string;
}
export type AcquisitionResult = readonly AcquiredRecord[] | AcquiredNull;
export interface AcquisitionContext {
  readonly signal: CancellationSignal;
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
  /** Optional wire-request identity; commit coverage is also included in deduplication. */
  fingerprint?(selection: readonly ResolvedField[]): string;
  read(
    selection: readonly ResolvedField[],
    context: AcquisitionContext,
  ): Promise<AcquisitionResult>;
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
class Handle {
  active = true;
  readonly lifetime = new Cancellation();
  attempt = 0;
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
    this.lifetime.abort('Query handle is disposed.');
    this.unsubscribe();
    this.listeners.clear();
    this.view.dispose();
  }
}

/** Shared acquisition with concurrent, generation-checked reads. */
export class AcquisitionClient {
  private readonly store = new StateStore();
  private readonly scopes = new Map<string, AcquisitionScheduler>();
  private disposed = false;
  private readonly retry: ReadRetrier;
  constructor(private readonly options: AcquisitionClientOptions = {}) {
    this.retry = new ReadRetrier(options);
  }
  watch(source: AcquisitionSource): QueryHandle {
    if (this.disposed) throw new Error('Client is disposed.');
    const selection = freezeFields(source.selection);
    const address = source.stateAddress;
    const collection = source.collection === true;
    let scope = this.scopes.get(address);
    if (scope && scope.collection !== collection)
      throw new Error(
        'Sources sharing an address must agree on collection semantics.',
      );
    if (!scope) {
      scope = new AcquisitionScheduler(
        this.store,
        address,
        selection,
        collection,
        this.retry,
      );
      this.scopes.set(address, scope);
    }
    const captured: AcquisitionSource = {
      stateAddress: address,
      selection,
      collection,
      read: source.read.bind(source),
      ...(source.fetchSelection
        ? { fetchSelection: source.fetchSelection.bind(source) }
        : {}),
      ...(source.fingerprint
        ? { fingerprint: source.fingerprint.bind(source) }
        : {}),
    };
    const view = this.store.watch(address, selection);
    const current = scope;
    const handle = new Handle(view, (error) => {
      // Observer failure must never become a transport failure or trigger a retry.
      try {
        this.options.onListenerError?.(error);
      } catch {
        /* Reporting cannot disrupt acquisition. */
      }
    });
    current.attach(handle);
    const enqueue = (
      requested?: readonly ResolvedField[],
      replaceMembership = false,
    ): Promise<void> => {
      if (this.disposed || !handle.active)
        return Promise.reject(new Error('Query handle is disposed.'));
      const attempt = ++handle.attempt;
      const task = Promise.resolve().then(async () => {
        if (this.disposed || !handle.active)
          throw (
            handle.lifetime.signal.reason ??
            new Error('Query handle is disposed.')
          );
        if (handle.attempt === attempt) {
          handle.error = undefined;
          handle.publish();
        }
        try {
          await cancellable(
            current.run(handle, captured, requested, replaceMembership),
            handle.lifetime.signal,
          );
        } catch (error) {
          if (handle.active && !this.disposed && handle.attempt === attempt) {
            handle.error =
              error instanceof Error ? error.message : String(error);
            handle.publish();
          }
          throw error;
        }
      });
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
        // Reserve queue order before notifying listeners, which may enqueue work.
        const task =
          options.refetch === 'none' ? Promise.resolve() : enqueue(fields);
        current.invalidate(paths);
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
        current.detach(handle);
      },
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const scope of this.scopes.values()) scope.dispose();
    this.scopes.clear();
    this.store.dispose();
  }
}

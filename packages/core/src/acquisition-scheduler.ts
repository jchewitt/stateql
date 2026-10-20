import {
  canonicalInput,
  mergeFields,
  narrowFields,
  selectFieldPath,
  snapshotInput,
  type ResolvedField,
} from './definition.js';
import { leafPaths, pathPrefix, staleChanges } from './acquisition-coverage.js';
import { reconcileAcquisition } from './acquisition-reconciliation.js';
import { AcquisitionVersions } from './acquisition-versions.js';
import { ReadTransportError, type ReadRetrier } from './read-retry.js';
import {
  Cancellation,
  cancellable,
  AcquisitionSupersededError,
} from './cancellation.js';
import type { AcquisitionResult, AcquisitionSource } from './acquisition.js';
import type { StateStore } from './state-store.js';
import type { FieldPath, StateChange, StateView } from './state-types.js';

export interface AcquisitionOwner {
  readonly active: boolean;
  readonly view: StateView;
  readonly lifetime: Cancellation;
  dispose(): void;
}
interface Request {
  readonly id: string;
  readonly key: string;
  readonly version: number;
  readonly fields: readonly ResolvedField[];
  readonly root: boolean;
  readonly cancellation: Cancellation;
  readonly owners: Set<AcquisitionOwner>;
  readonly promise: Promise<void>;
  live: boolean;
}
function overlaps(
  a: readonly ResolvedField[],
  b: readonly ResolvedField[],
): boolean {
  return leafPaths(a).some((left) =>
    leafPaths(b).some(
      (right) => pathPrefix(left, right) || pathPrefix(right, left),
    ),
  );
}
function needed(view: StateView): readonly ResolvedField[] {
  const snapshot = view.getSnapshot();
  if (snapshot.records === undefined) return view.selection;
  if (snapshot.records === null) return snapshot.stale ? view.selection : [];
  let fields: readonly ResolvedField[] = [];
  for (const record of snapshot.records)
    for (const status of record.fields)
      if (!status.present || status.stale || status.error !== undefined)
        fields = mergeFields(
          fields,
          selectFieldPath(view.selection, status.path),
        );
  return fields;
}

/** One resource's request ownership, deduplication and local commit generations. */
export class AcquisitionScheduler {
  private readonly owners = new Set<AcquisitionOwner>();
  private readonly requests = new Set<Request>();
  private readonly versions = new AcquisitionVersions();
  private readonly view: StateView;
  private disposed = false;
  constructor(
    private readonly store: StateStore,
    readonly address: string,
    selection: readonly ResolvedField[],
    readonly collection: boolean,
    private readonly retry: ReadRetrier,
  ) {
    // Membership must remain live when the owner that started a read disposes.
    this.view = store.watch(address, selection);
  }
  attach(owner: AcquisitionOwner): void {
    this.owners.add(owner);
    for (const request of this.requests)
      if (request.root || overlaps(request.fields, owner.view.selection))
        request.owners.add(owner);
  }
  detach(owner: AcquisitionOwner): void {
    this.owners.delete(owner);
    for (const request of [...this.requests]) {
      request.owners.delete(owner);
      if (!request.owners.size) {
        this.finish(request);
        request.cancellation.abort('Acquisition has no active owners.');
      }
    }
  }
  private assertOwner(owner: AcquisitionOwner): void {
    if (this.disposed || !owner.active)
      throw (
        owner.lifetime.signal.reason ?? new Error('Query handle is disposed.')
      );
  }
  invalidate(paths: readonly FieldPath[]): void {
    this.versions.invalidate(paths);
    const records = this.view.getSnapshot().records;
    this.store.commit(
      this.address,
      records === null
        ? [{ kind: 'membership-stale' }]
        : staleChanges(records ?? [], paths),
    );
  }
  async run(
    owner: AcquisitionOwner,
    source: AcquisitionSource,
    requested?: readonly ResolvedField[],
    replaceMembership = false,
  ): Promise<void> {
    this.assertOwner(owner);
    let fields = requested ?? needed(owner.view);
    if (requested === undefined) {
      // Reuse in-flight coverage before asking for additional missing fields.
      // Forced reads still run concurrently and are protected at commit time.
      while (fields.length) {
        const covering = [...this.requests].filter(
          (request) =>
            this.versions.current(request.version, request.fields) &&
            (request.root || overlaps(fields, request.fields)),
        );
        if (!covering.length) break;
        await cancellable(
          Promise.all(
            covering.map((request) =>
              request.promise.catch((error: unknown) => {
                if (!(error instanceof AcquisitionSupersededError)) throw error;
              }),
            ),
          ),
          owner.lifetime.signal,
        );
        this.assertOwner(owner);
        fields = needed(owner.view);
      }
    }
    if (!fields.length) return;
    const fetched = source.fetchSelection
      ? narrowFields(source.selection, source.fetchSelection(fields))
      : fields;
    narrowFields(fetched, fields);
    const fingerprint =
      source.fingerprint?.(fetched) ?? canonicalInput(fetched);
    if (typeof fingerprint !== 'string' || !fingerprint)
      throw new Error('Source fingerprint must be a non-empty string.');
    const key = canonicalInput([
      fingerprint,
      fields,
      fetched,
      replaceMembership,
    ]);
    const existing = [...this.requests].find(
      (request) =>
        request.key === key && this.versions.current(request.version, fields),
    );
    const request =
      existing ?? this.start(source, fields, fetched, key, replaceMembership);
    try {
      await cancellable(request.promise, owner.lifetime.signal);
    } catch (error) {
      if (
        requested === undefined &&
        error instanceof AcquisitionSupersededError
      )
        return this.run(owner, source);
      throw error;
    }
  }
  private start(
    source: AcquisitionSource,
    fields: readonly ResolvedField[],
    fetched: readonly ResolvedField[],
    key: string,
    replaceMembership: boolean,
  ): Request {
    const root = replaceMembership || this.view.getSnapshot().records == null;
    const version = this.versions.advance(leafPaths(fields), root);
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void promise.catch(() => {});
    const request: Request = {
      id: String(version),
      key,
      version,
      fields,
      root,
      promise,
      cancellation: new Cancellation(),
      live: true,
      owners: new Set(
        [...this.owners].filter(
          (owner) => root || overlaps(fields, owner.view.selection),
        ),
      ),
    };
    this.requests.add(request);
    void this.execute(request, source, fetched, replaceMembership).then(
      resolve,
      reject,
    );
    return request;
  }
  private async execute(
    request: Request,
    source: AcquisitionSource,
    fetched: readonly ResolvedField[],
    replaceMembership: boolean,
  ): Promise<void> {
    try {
      this.store.setFetching(
        this.address,
        request.id,
        request.fields,
        request.root,
      );
      if (!request.live || !request.owners.size || this.disposed)
        throw (
          request.cancellation.signal.reason ??
          new Error('Acquisition has no active owners.')
        );
      let response: AcquisitionResult;
      try {
        response = await this.retry.read(
          () => source.read(fetched, { signal: request.cancellation.signal }),
          request.cancellation.signal,
          () =>
            request.live &&
            this.versions.current(request.version, request.fields),
        );
      } catch (error) {
        if (
          request.live &&
          !this.disposed &&
          error instanceof ReadTransportError
        )
          this.failFields(request, error);
        throw error;
      }
      if (!request.live || this.disposed)
        throw (
          request.cancellation.signal.reason ??
          new Error('Acquisition has no active owners.')
        );
      const acquired = snapshotInput(response) as unknown as AcquisitionResult;
      const result = reconcileAcquisition({
        acquired,
        known: this.view.getSnapshot().records,
        requested: request.fields,
        fetched,
        collection: this.collection,
        replaceMembership,
        pendingInvalidations: this.versions.pending(request.version),
      });
      const eligible = this.versions.filter(
        request.version,
        result.changes,
        this.store,
        this.address,
      );
      if (eligible.changes.length) {
        this.versions.committed(
          request.version,
          eligible.changes,
          this.store,
          this.address,
        );
        this.store.commit(this.address, eligible.changes);
      }
      if (eligible.superseded) throw new AcquisitionSupersededError();
      if (result.incomplete) throw new Error(result.incomplete);
    } finally {
      this.finish(request);
    }
  }
  private failFields(request: Request, error: ReadTransportError): void {
    const records = this.view.getSnapshot().records;
    // No invented records or conversion of a transport failure into resource null.
    const changes: StateChange[] = (records ?? []).flatMap((record) =>
      leafPaths(request.fields).map((path) => ({
        kind: 'error' as const,
        record: record.identity,
        path,
        message: error.message,
      })),
    );
    const eligible = this.versions.filter(
      request.version,
      changes,
      this.store,
      this.address,
    );
    if (eligible.changes.length) {
      this.versions.committed(
        request.version,
        eligible.changes,
        this.store,
        this.address,
      );
      this.store.commit(this.address, eligible.changes);
    }
    if (eligible.superseded) throw new AcquisitionSupersededError();
  }
  private finish(request: Request): void {
    if (!request.live) return;
    request.live = false;
    this.requests.delete(request);
    if (!this.disposed) this.store.setFetching(this.address, request.id);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const owner of this.owners) owner.dispose();
    this.owners.clear();
    for (const request of this.requests) {
      request.live = false;
      request.cancellation.abort('Acquisition client is disposed.');
    }
    this.requests.clear();
    this.view.dispose();
  }
}

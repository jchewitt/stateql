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
import type { ReadDeadline } from './read-deadline.js';
import { FreshnessTracker } from './freshness.js';
import { InactiveRetention } from './inactive-retention.js';
import type { FreshnessScheduler, MonotonicScheduler } from './read-retry.js';
import type { FreshnessPolicy } from './request-policy.js';
import {
  Cancellation,
  cancellable,
  AcquisitionSupersededError,
} from './cancellation.js';
import type {
  AcquiredRecord,
  AcquisitionResult,
  AcquisitionSource,
} from './acquisition.js';
import type { StateStore } from './state-store.js';
import type { FieldPath, StateChange, StateView } from './state-types.js';

export interface AcquisitionOwner {
  readonly active: boolean;
  readonly view: StateView;
  readonly lifetime: Cancellation;
  revalidate(): void;
  freshnessError(error: unknown): void;
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

function remaining(
  fields: readonly ResolvedField[],
  satisfied: readonly FieldPath[],
  parent: FieldPath = [],
): readonly ResolvedField[] {
  return fields.flatMap((field) => {
    const path = [...parent, { name: field.name, arguments: field.arguments }];
    if (satisfied.some((covered) => pathPrefix(covered, path))) return [];
    if (!field.children.length) return [field];
    const children = remaining(field.children, satisfied, path);
    return children.length ? [{ ...field, children }] : [];
  });
}
/** One resource's request ownership, deduplication and local commit generations. */
export class AcquisitionScheduler {
  private readonly owners = new Set<AcquisitionOwner>();
  private readonly requests = new Set<Request>();
  private readonly versions = new AcquisitionVersions();
  private view: StateView | undefined;
  private disposed = false;
  private readonly freshness: FreshnessTracker;
  private readonly retention: InactiveRetention;
  constructor(
    private readonly store: StateStore,
    readonly address: string,
    selection: readonly ResolvedField[],
    readonly collection: boolean,
    private readonly retry: ReadRetrier,
    private readonly deadline: ReadDeadline,
    readonly freshnessPolicy: Required<FreshnessPolicy>,
    freshnessScheduler: FreshnessScheduler | undefined,
    retention: {
      readonly durationMs: number | false;
      readonly scheduler: MonotonicScheduler | undefined;
      readonly evict: (scope: AcquisitionScheduler) => void;
      readonly report: (error: unknown) => void;
    },
    private authorityValue: object | undefined,
  ) {
    this.retention = new InactiveRetention(
      retention.durationMs,
      retention.scheduler,
      () => retention.evict(this),
      retention.report,
    );
    this.freshness = new FreshnessTracker(
      freshnessPolicy,
      freshnessScheduler,
      store,
      address,
      (changes) => {
        this.store.commit(address, changes);
        if (this.freshness.canRevalidate)
          for (const owner of [...this.owners])
            if (
              owner.active &&
              changes.some(
                (change) =>
                  change.kind === 'membership-stale' ||
                  ('path' in change &&
                    leafPaths(owner.view.selection).some(
                      (path) =>
                        pathPrefix(change.path, path) ||
                        pathPrefix(path, change.path),
                    )),
              )
            )
              owner.revalidate();
      },
      (error) => {
        for (const owner of this.owners)
          if (owner.active) owner.freshnessError(error);
      },
    );
    // Membership must remain live when the owner that started a read disposes.
    this.view = store.watch(address, selection);
  }
  get requestTimeoutMs(): number | false {
    return this.deadline.timeoutMs;
  }
  get authority(): object | undefined {
    return this.authorityValue;
  }
  get retentionMs(): number | false {
    return this.retention.durationMs;
  }
  get hasOwners(): boolean {
    return this.owners.size > 0;
  }
  expireInactive(): void {
    this.retention.expireIfDue();
  }
  attach(owner: AcquisitionOwner): void {
    this.owners.add(owner);
    this.retention.activate();
    for (const request of this.requests)
      if (request.root || overlaps(request.fields, owner.view.selection))
        request.owners.add(owner);
    this.freshness.setActive(true);
  }
  detach(owner: AcquisitionOwner): void {
    if (this.disposed || !this.owners.delete(owner)) return;
    for (const request of [...this.requests]) {
      request.owners.delete(owner);
      if (!request.owners.size) {
        this.finish(request);
        request.cancellation.abort('Acquisition has no active owners.');
      }
    }
    if (!this.owners.size) {
      this.freshness.setActive(false);
      // Adapter cancellation callbacks may synchronously attach a new owner.
      if (!this.owners.size && !this.disposed) this.retention.deactivate();
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
    const records = this.view!.getSnapshot().records;
    const changes: readonly StateChange[] =
      records === null
        ? [{ kind: 'membership-stale' }]
        : staleChanges(records ?? [], paths);
    this.store.commit(this.address, this.freshness.record(changes));
    this.freshness.schedule();
  }
  ingest(
    selection: readonly ResolvedField[],
    records: readonly AcquiredRecord[],
  ): void {
    if (this.disposed || !this.owners.size)
      throw new Error('Patch requires an existing active resource.');
    const result = reconcileAcquisition({
      acquired: snapshotInput(records) as unknown as AcquisitionResult,
      known: this.view!.getSnapshot().records,
      requested: selection,
      fetched: selection,
      collection: this.collection,
      replaceMembership: false,
      pendingInvalidations: [],
      patch: true,
    });
    // Validation must finish before an invalid event can affect read eligibility.
    // Empty intent paths tick the local clock without superseding untouched records.
    const version = this.versions.advance([]);
    this.commit(version, result.changes);
  }
  private commit(version: number, changes: readonly StateChange[]): boolean {
    const eligible = this.versions.filter(
      version,
      changes,
      this.store,
      this.address,
    );
    if (eligible.changes.length) {
      const aged = this.freshness.record(eligible.changes);
      this.versions.committed(
        version,
        eligible.changes,
        this.store,
        this.address,
      );
      this.store.commit(this.address, aged);
      this.freshness.schedule();
    }
    return eligible.superseded;
  }
  async run(
    owner: AcquisitionOwner,
    source: AcquisitionSource,
    requested?: readonly ResolvedField[],
    replaceMembership = false,
  ): Promise<void> {
    this.assertOwner(owner);
    this.freshness.expire();
    this.assertOwner(owner);
    let membershipNeeded =
      requested === undefined && this.freshness.membershipExpired;
    let fields =
      requested ??
      (membershipNeeded ? owner.view.selection : needed(owner.view));
    const completed = new Set<Request>();
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
              request.promise
                .then(() => {
                  completed.add(request);
                })
                .catch((error: unknown) => {
                  if (!(error instanceof AcquisitionSupersededError))
                    throw error;
                }),
            ),
          ),
          owner.lifetime.signal,
        );
        this.assertOwner(owner);
        const satisfied = [...completed].filter((request) =>
          this.versions.current(request.version, request.fields),
        );
        const rootSatisfied = satisfied.some((request) => request.root);
        membershipNeeded = this.freshness.membershipExpired && !rootSatisfied;
        fields = membershipNeeded
          ? owner.view.selection
          : remaining(
              needed(owner.view),
              satisfied.flatMap((request) => leafPaths(request.fields)),
            );
        if (membershipNeeded) break;
      }
    }
    if (!fields.length) return;
    if (membershipNeeded) replaceMembership = true;
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
    const root = replaceMembership || this.view!.getSnapshot().records == null;
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
        response = await this.deadline.run(
          (signal) =>
            this.retry.read(
              () => source.read(fetched, { signal }),
              signal,
              () =>
                request.live &&
                this.versions.current(request.version, request.fields),
            ),
          request.cancellation.signal,
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
        known: this.view!.getSnapshot().records,
        requested: request.fields,
        fetched,
        collection: this.collection,
        replaceMembership,
        pendingInvalidations: this.versions.pending(request.version),
      });
      if (this.commit(request.version, result.changes))
        throw new AcquisitionSupersededError();
      if (result.incomplete) throw new Error(result.incomplete);
    } finally {
      this.finish(request);
    }
  }
  private failFields(request: Request, error: ReadTransportError): void {
    const records = this.view!.getSnapshot().records;
    // No invented records or conversion of a transport failure into resource null.
    const changes: StateChange[] = (records ?? []).flatMap((record) =>
      leafPaths(request.fields).map((path) => ({
        kind: 'error' as const,
        record: record.identity,
        path,
        message: error.message,
      })),
    );
    if (this.commit(request.version, changes))
      throw new AcquisitionSupersededError();
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
    this.authorityValue = undefined;
    this.retention.dispose();
    this.freshness.dispose();
    for (const owner of this.owners) owner.dispose();
    this.owners.clear();
    for (const request of this.requests) {
      request.live = false;
      request.cancellation.abort('Acquisition client is disposed.');
    }
    this.requests.clear();
    this.versions.dispose();
    this.view?.dispose();
    this.view = undefined;
  }
}

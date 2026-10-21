import { canonicalInput } from './definition.js';
import { pathPrefix } from './acquisition-coverage.js';
import { Cancellation } from './cancellation.js';
import type { FreshnessScheduler } from './read-retry.js';
import type { FreshnessPolicy } from './request-policy.js';
import type { FieldPath, RecordIdentity, StateChange } from './state-types.js';
import type { StateStore } from './state-store.js';

interface Coverage {
  readonly due: number;
  readonly change: Extract<StateChange, { kind: 'stale' | 'membership-stale' }>;
}

/** Accepted coverage age, independent of request generations and platform timers. */
export class FreshnessTracker {
  private readonly coverage = new Map<string, Coverage>();
  private timer: Cancellation | undefined;
  private active = false;
  private failed = false;
  private lastNow = -Infinity;
  private pendingFailure: { readonly error: unknown } | undefined;
  membershipExpired = false;
  get canRevalidate(): boolean {
    return !this.failed && this.policy.revalidate === 'active';
  }
  constructor(
    readonly policy: Required<FreshnessPolicy>,
    private readonly clock: FreshnessScheduler | undefined,
    private readonly store: StateStore,
    private readonly address: string,
    private readonly onExpire: (changes: readonly StateChange[]) => void,
    private readonly onFailure: (error: unknown) => void,
  ) {
    if (policy.staleTimeMs !== false) {
      if (!clock)
        throw new Error('Freshness expiry requires a freshnessScheduler.');
      this.now();
    }
  }
  private now(): number {
    const now = this.clock!.now();
    if (!Number.isFinite(now) || now < this.lastNow)
      throw new Error(
        'Freshness scheduler now() must return finite nondecreasing milliseconds.',
      );
    this.lastNow = now;
    return now;
  }
  private remove(record: RecordIdentity, path: FieldPath): void {
    for (const [key, entry] of this.coverage)
      if (
        entry.change.kind === 'stale' &&
        canonicalInput(entry.change.record) === canonicalInput(record) &&
        pathPrefix(path, entry.change.path)
      )
        this.coverage.delete(key);
  }
  /** Called only for generation-eligible changes, before publication/reentrant observers. */
  record(changes: readonly StateChange[]): readonly StateChange[] {
    if (this.policy.staleTimeMs === false) return changes;
    let due = -Infinity;
    if (!this.failed) {
      try {
        due = this.now() + this.policy.staleTimeMs;
      } catch (error) {
        // Defer notification until the caller publishes this whole commit. A
        // reentrant observer must not interleave writes into a half-applied batch.
        this.failed = true;
        this.cancelTimer();
        this.pendingFailure = { error };
      }
    }
    for (const change of changes) {
      if (
        change.kind === 'write' ||
        change.kind === 'object' ||
        (change.kind === 'error' && change.structuralNull)
      ) {
        for (const [key, entry] of this.coverage)
          if (
            entry.change.kind === 'stale' &&
            canonicalInput(entry.change.record) ===
              canonicalInput(change.record) &&
            entry.change.path.length < change.path.length &&
            pathPrefix(entry.change.path, change.path)
          )
            this.coverage.delete(key);
      }
      if (change.kind === 'membership' || change.kind === 'resource-null') {
        this.membershipExpired = false;
        const members = new Set(
          change.kind === 'membership'
            ? change.records.map(canonicalInput)
            : [],
        );
        for (const [key, entry] of this.coverage)
          if (
            entry.change.kind === 'stale' &&
            !members.has(canonicalInput(entry.change.record))
          )
            this.coverage.delete(key);
        this.coverage.delete('membership');
        if (change.kind === 'membership' || change.error === undefined)
          this.coverage.set('membership', {
            due,
            change: { kind: 'membership-stale' },
          });
      } else if (change.kind === 'membership-stale') {
        this.coverage.delete('membership');
      } else if (change.kind === 'object') {
        if (
          !this.store.matchesObject(
            this.address,
            change.record,
            change.path,
            change.identity,
          )
        )
          this.remove(change.record, change.path);
      } else {
        this.remove(change.record, change.path);
        if (change.kind === 'write')
          this.coverage.set(canonicalInput([change.record, change.path]), {
            due,
            change: { kind: 'stale', record: change.record, path: change.path },
          });
      }
    }
    // Immediate stale is part of the same atomic commit, never a zero-delay refresh loop.
    return this.policy.staleTimeMs === 0 || this.failed
      ? [...changes, ...this.takeDue(Infinity)]
      : changes;
  }
  private takeDue(now: number): StateChange[] {
    const changes: StateChange[] = [];
    for (const [key, entry] of this.coverage)
      if (entry.due <= now) {
        this.coverage.delete(key);
        changes.push(entry.change);
        if (entry.change.kind === 'membership-stale')
          this.membershipExpired = true;
      }
    return changes;
  }
  /** Check wall-time-independent age on demand, including after an inactive interval. */
  expire(): void {
    if (this.policy.staleTimeMs === false || this.failed) return;
    try {
      const changes = this.takeDue(this.now());
      if (changes.length) this.onExpire(changes);
    } catch (error) {
      this.fail(error);
    }
  }
  setActive(active: boolean): void {
    this.active = active;
    this.cancelTimer();
    if (active) this.expire();
    this.schedule();
  }
  schedule(): void {
    this.cancelTimer();
    if (this.pendingFailure) {
      const { error } = this.pendingFailure;
      this.pendingFailure = undefined;
      this.onFailure(error);
    }
    if (!this.active || this.failed || !this.coverage.size) return;
    const timer = new Cancellation();
    this.timer = timer;
    try {
      let due = Infinity;
      for (const entry of this.coverage.values())
        due = Math.min(due, entry.due);
      const delay = Math.max(0, due - this.now());
      void this.clock!.wait(delay, timer.signal).then(
        () => {
          if (this.timer !== timer || timer.signal.aborted) return;
          this.timer = undefined;
          this.expire();
          this.schedule();
        },
        (error: unknown) => {
          if (this.timer === timer && !timer.signal.aborted) this.fail(error);
        },
      );
    } catch (error) {
      this.fail(error);
    }
  }
  private fail(error: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.cancelTimer();
    // Clock failure cannot make old data fresh or trigger a retry loop.
    const changes = this.takeDue(Infinity);
    if (changes.length) this.onExpire(changes);
    this.onFailure(error);
  }
  private cancelTimer(): void {
    const timer = this.timer;
    this.timer = undefined;
    timer?.abort('Freshness timer released.');
  }
  dispose(): void {
    this.active = false;
    this.cancelTimer();
    this.coverage.clear();
  }
}

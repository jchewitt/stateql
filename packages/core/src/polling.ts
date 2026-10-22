import { canonicalInput, type ResolvedField } from './definition.js';
import { leafPaths } from './acquisition-coverage.js';
import { Cancellation } from './cancellation.js';
import type { MonotonicScheduler } from './read-retry.js';

export interface PollOptions<Target extends string = string> {
  readonly target?: Target;
  /** Omission inherits the handle's configured polling default; false disables this interest. */
  readonly everyMs?: number | false;
}
export function validatePollInterval(
  value: unknown,
): asserts value is number | false {
  if (
    value !== false &&
    (!Number.isInteger(value) ||
      (value as number) < 1 ||
      (value as number) > 2_147_483_647)
  )
    throw new Error(
      'Polling everyMs must be false or integer milliseconds from 1 to 2147483647.',
    );
}
interface Owner {
  readonly active: boolean;
}
interface Interest {
  owner: Owner | undefined;
  readonly everyMs: number;
  due: number;
  run: ((interested: () => boolean) => Promise<void>) | undefined;
  report: ((error: unknown) => void) | undefined;
  stop: () => void;
}
interface Group {
  readonly key: string;
  readonly fields: readonly ResolvedField[];
  readonly interests: Set<Interest>;
  running: boolean;
  revision: number;
  timer?:
    { readonly cancellation: Cancellation; readonly due: number } | undefined;
}
function once(action: () => void): () => void {
  let cleanup: (() => void) | undefined = action;
  return () => {
    const run = cleanup;
    cleanup = undefined;
    run?.();
  };
}

/** Owner interests and fixed-delay clocks only; acquisition still owns requests and retries. */
export class FieldPolling {
  private readonly groups = new Map<string, Group>();
  private disposed = false;
  private lastNow = -Infinity;
  constructor(
    private readonly clock: MonotonicScheduler | undefined,
    private readonly settle: (
      fields: readonly ResolvedField[],
    ) => Promise<void>,
  ) {}
  private now(): number {
    const value = this.clock!.now();
    if (!Number.isFinite(value) || value < this.lastNow)
      throw new Error(
        'Polling scheduler now() must return finite nondecreasing milliseconds.',
      );
    this.lastNow = value;
    return value;
  }
  private live(group: Group): boolean {
    return (
      !this.disposed &&
      this.groups.get(group.key) === group &&
      group.interests.size > 0
    );
  }
  add(
    owner: Owner,
    fields: readonly ResolvedField[],
    everyMs: number,
    run: Interest['run'],
    report: Interest['report'],
  ): () => void {
    if (!this.clock)
      throw new Error(
        'Polling requires a pollingScheduler or freshnessScheduler.',
      );
    const due = this.now() + everyMs;
    if (this.disposed || !owner.active)
      throw new Error('Query handle is disposed.');
    const key = canonicalInput(
      leafPaths(fields)
        .map((path) => canonicalInput(path))
        .sort(),
    );
    let group = this.groups.get(key);
    if (!group) {
      group = {
        key,
        fields,
        interests: new Set(),
        running: false,
        revision: 0,
      };
      this.groups.set(key, group);
    }
    const current = group;
    const interest: Interest = {
      owner,
      everyMs,
      due,
      run,
      report,
      stop: () => {},
    };
    interest.stop = once(() => this.remove(current, interest));
    current.interests.add(interest);
    this.schedule(current);
    return interest.stop;
  }
  private remove(group: Group, interest: Interest): void {
    group.interests.delete(interest);
    interest.owner = undefined;
    interest.run = undefined;
    interest.report = undefined;
    if (!group.interests.size) {
      if (this.groups.get(group.key) === group) this.groups.delete(group.key);
      group.revision++;
      this.cancel(group);
    } else this.schedule(group);
  }
  removeOwner(owner: Owner): void {
    for (const group of [...this.groups.values()])
      for (const interest of [...group.interests])
        if (interest.owner === owner) interest.stop();
  }
  private cancel(group: Group): void {
    const timer = group.timer;
    group.timer = undefined;
    timer?.cancellation.abort('Polling timer released.');
  }
  private schedule(group: Group): void {
    if (!this.live(group) || group.running) return;
    const due = Math.min(
      ...[...group.interests].map((interest) => interest.due),
    );
    if (group.timer?.due === due) return;
    const revision = ++group.revision;
    this.cancel(group);
    if (!this.live(group) || group.revision !== revision) return;
    try {
      const delay = Math.max(0, Math.ceil(due - this.now()));
      if (!this.live(group) || group.revision !== revision) return;
      const timer = { cancellation: new Cancellation(), due };
      group.timer = timer;
      const current = () =>
        this.live(group) &&
        group.timer === timer &&
        !timer.cancellation.signal.aborted;
      void this.clock!.wait(delay, timer.cancellation.signal).then(
        () => {
          if (!current()) return;
          try {
            const now = this.now();
            if (!current()) return;
            group.timer = undefined;
            if (now < due) this.schedule(group);
            else void this.tick(group);
          } catch (error) {
            if (current()) this.fail(group, error);
          }
        },
        (error) => {
          if (current()) this.fail(group, error);
        },
      );
    } catch (error) {
      if (this.live(group) && group.revision === revision)
        this.fail(group, error);
    }
  }
  private async tick(group: Group): Promise<void> {
    if (!this.live(group) || group.running) return;
    group.running = true;
    const participants = new Set<Owner>();
    for (const interest of group.interests)
      if (interest.owner?.active) participants.add(interest.owner);
    await Promise.allSettled(
      [...participants].map((owner) => {
        const interested = () =>
          this.live(group) &&
          owner.active &&
          [...group.interests].some((item) => item.owner === owner);
        return Promise.resolve().then(() => {
          if (!interested()) return;
          // A duplicate registration may stop before dispatch while this owner remains.
          const interest = [...group.interests].find(
            (item) => item.owner === owner,
          );
          return interest?.run?.(interested);
        });
      }),
    );
    try {
      // A participant can leave while ordinary/new owners still retain the shared read.
      await this.settle(group.fields);
      if (!this.live(group)) return;
      const now = this.now();
      if (!this.live(group)) return;
      for (const interest of group.interests)
        interest.due = now + interest.everyMs;
      group.running = false;
      this.schedule(group);
    } catch (error) {
      if (this.live(group)) this.fail(group, error);
    }
  }
  private fail(group: Group, error: unknown): void {
    const reports = new Map<Owner, (error: unknown) => void>();
    for (const interest of group.interests)
      if (interest.owner?.active && interest.report)
        reports.set(interest.owner, interest.report);
    this.groups.delete(group.key);
    for (const interest of [...group.interests]) interest.stop();
    for (const [owner, report] of reports)
      if (owner.active) {
        try {
          report(error);
        } catch {
          /* A reporting failure must not interrupt other owners' cleanup/reporting. */
        }
      }
  }
  dispose(): void {
    this.disposed = true;
    for (const group of [...this.groups.values()])
      for (const interest of [...group.interests]) interest.stop();
    this.groups.clear();
  }
}

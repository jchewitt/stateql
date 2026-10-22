import { Cancellation } from './cancellation.js';
import type { MonotonicScheduler } from './read-retry.js';

/** One scope's inactive lifetime. It never owns data, requests or platform timers. */
export class InactiveRetention {
  private due: number | undefined;
  private timer: Cancellation | undefined;
  private disposed = false;
  private active = true;
  private generation = 0;
  private lastNow = -Infinity;
  constructor(
    readonly durationMs: number | false,
    private readonly clock: MonotonicScheduler | undefined,
    private readonly evict: () => void,
    private readonly report: (error: unknown) => void,
  ) {
    if (durationMs !== false && durationMs > 0) {
      if (!clock)
        throw new Error(
          'Positive retentionMs requires a retentionScheduler or freshnessScheduler.',
        );
      this.now();
    }
  }
  private now(): number {
    const now = this.clock!.now();
    if (!Number.isFinite(now) || now < this.lastNow)
      throw new Error(
        'Retention scheduler now() must return finite nondecreasing milliseconds.',
      );
    this.lastNow = now;
    return now;
  }
  activate(): void {
    this.active = true;
    this.generation++;
    this.due = undefined;
    this.cancelTimer();
  }
  /** Only a real transition from at least one owner to zero starts retention. */
  deactivate(): void {
    if (this.disposed || this.durationMs === false || this.due !== undefined)
      return;
    this.active = false;
    const generation = ++this.generation;
    if (this.durationMs === 0) {
      this.retire();
      return;
    }
    try {
      const due = this.now() + this.durationMs;
      if (this.disposed || this.active || generation !== this.generation)
        return;
      this.due = due;
    } catch (error) {
      if (!this.disposed && !this.active && generation === this.generation)
        this.fail(error);
      return;
    }
    this.schedule();
  }
  /** Demand checks elapsed time before considering old immutable policy bindings. */
  expireIfDue(): void {
    if (this.disposed || this.active || this.due === undefined) return;
    const generation = this.generation;
    const due = this.due;
    try {
      const now = this.now();
      if (
        !this.disposed &&
        !this.active &&
        generation === this.generation &&
        now >= due
      )
        this.retire();
    } catch (error) {
      if (!this.disposed && !this.active && generation === this.generation)
        this.fail(error);
    }
  }
  private schedule(): void {
    if (this.disposed || this.active || this.due === undefined) return;
    const timer = new Cancellation();
    this.timer = timer;
    try {
      const remaining = Math.max(0, Math.ceil(this.due - this.now()));
      if (this.timer !== timer || this.disposed || this.active) return;
      void this.clock!.wait(remaining, timer.signal).then(
        () => {
          if (this.timer !== timer || timer.signal.aborted || this.disposed)
            return;
          this.timer = undefined;
          this.expireIfDue();
          // A platform timer may wake early; only elapsed monotonic time can evict.
          this.schedule();
        },
        (error: unknown) => {
          if (this.timer === timer && !timer.signal.aborted && !this.disposed)
            this.fail(error);
        },
      );
    } catch (error) {
      if (this.timer === timer && !timer.signal.aborted && !this.disposed)
        this.fail(error);
    }
  }
  private fail(error: unknown): void {
    if (this.disposed || this.active) return;
    this.retire();
    try {
      this.report(error);
    } catch {
      /* Diagnostics cannot prevent cleanup. */
    }
  }
  private retire(): void {
    if (this.disposed || this.active) return;
    this.disposed = true;
    this.due = undefined;
    const timer = this.timer;
    this.timer = undefined;
    // Remove the old scope before cancellation can reenter through adapter code.
    try {
      this.evict();
    } finally {
      timer?.abort('Inactive resource was evicted.');
    }
  }
  private cancelTimer(): void {
    const timer = this.timer;
    this.timer = undefined;
    timer?.abort('Inactive retention timer released.');
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.due = undefined;
    this.cancelTimer();
  }
}

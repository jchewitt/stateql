import { Cancellation, type CancellationSignal } from './cancellation.js';
import { ReadTransportError, type DelayScheduler } from './read-retry.js';
import { validateRequestTimeout } from './request-policy.js';

/** The shared request exhausted its whole budget; it cannot retry within that budget. */
export class ReadTimeoutError extends ReadTransportError {
  override readonly name = 'ReadTimeoutError';
  constructor(readonly timeoutMs: number) {
    if (typeof timeoutMs !== 'number')
      throw new Error('ReadTimeoutError requires numeric timeoutMs.');
    validateRequestTimeout(timeoutMs);
    super(`Read request exceeded its ${timeoutMs}ms deadline.`, {
      retryable: false,
    });
  }
}

/** One cancellable timer around the entire retry chain, independent of any one owner. */
export class ReadDeadline {
  private readonly wait: DelayScheduler['wait'] | undefined;
  constructor(
    readonly timeoutMs: number | false,
    scheduler?: DelayScheduler,
  ) {
    if (
      timeoutMs !== false &&
      (!scheduler || typeof scheduler.wait !== 'function')
    )
      throw new Error('Portable request deadlines require a DelayScheduler.');
    this.wait = scheduler?.wait.bind(scheduler);
  }
  run<T>(
    work: (signal: CancellationSignal) => Promise<T>,
    parent: CancellationSignal,
  ): Promise<T> {
    if (this.timeoutMs === false) return work(parent);
    const timeoutMs = this.timeoutMs;
    return new Promise<T>((resolve, reject) => {
      const read = new Cancellation();
      const timer = new Cancellation();
      let settled = false;
      let unsubscribe = () => {};
      const finish = (action: () => void, abort?: string) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        timer.abort('Request deadline timer released.');
        if (abort !== undefined) read.abort(abort);
        action();
      };
      unsubscribe = parent.subscribe(() =>
        finish(() => reject(parent.reason), parent.reason!.message),
      );
      if (settled) {
        unsubscribe();
        return;
      }
      const schedulerFailed = (cause: unknown) => {
        const error = new Error('Request deadline scheduler failed.', {
          cause,
        });
        finish(() => reject(error), error.message);
      };
      try {
        void this.wait!(timeoutMs, timer.signal).then(() => {
          const error = new ReadTimeoutError(timeoutMs);
          finish(() => reject(error), error.message);
        }, schedulerFailed);
      } catch (cause) {
        schedulerFailed(cause);
      }
      if (settled) return;
      try {
        void work(read.signal).then(
          (value) => finish(() => resolve(value)),
          (error: unknown) => finish(() => reject(error)),
        );
      } catch (error) {
        finish(() => reject(error));
      }
    });
  }
}

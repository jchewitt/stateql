import {
  cancellable,
  AcquisitionCancelledError,
  AcquisitionSupersededError,
  type CancellationSignal,
} from './cancellation.js';
import type { ResourceConfigurationOptions } from './resource-configuration.js';
import type { AcquisitionCapabilities } from './acquisition.js';

/** Explicit source classification. Ordinary exceptions are never automatically retried. */
export class ReadTransportError extends Error {
  override readonly name: string = 'ReadTransportError';
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  constructor(
    message: string,
    options: {
      readonly retryable: boolean;
      readonly retryAfterMs?: number;
      readonly cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    if (!message.trim() || typeof options.retryable !== 'boolean')
      throw new Error(
        'ReadTransportError requires a message and boolean retryable classification.',
      );
    if (
      options.retryAfterMs !== undefined &&
      (!Number.isFinite(options.retryAfterMs) || options.retryAfterMs < 0)
    )
      throw new Error('retryAfterMs must be a finite nonnegative duration.');
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export interface ReadRetryPolicy {
  /** Additional attempts after the first read, from zero to ten. Default: two. */
  readonly retries?: number;
  /** Exponential backoff base in milliseconds. Default: 250. */
  readonly initialDelayMs?: number;
  /** Maximum backoff/server-requested wait in milliseconds. Default: 30000. */
  readonly maxDelayMs?: number;
}
/** Supplied by the platform adapter; core imports no timers or browser globals. */
export interface DelayScheduler {
  wait(delayMs: number, signal: CancellationSignal): Promise<void>;
}
export interface RetryScheduler extends DelayScheduler {
  /** A sample in [0, 1), used for full jitter. */
  random(): number;
}
export interface MonotonicScheduler extends DelayScheduler {
  /** Finite, nondecreasing milliseconds in one runtime-local clock domain. */
  now(): number;
}
/** Backward-compatible name for the monotonic scheduling capability. */
export type FreshnessScheduler = MonotonicScheduler;
export interface AcquisitionClientOptions extends ResourceConfigurationOptions<AcquisitionCapabilities> {
  readonly onListenerError?: (error: unknown) => void;
  /** Omitted/false disables retries in portable core. GraphQL supplies defaults. */
  readonly retry?: ReadRetryPolicy | false;
  readonly scheduler?: RetryScheduler;
  /** Defaults to scheduler when supplied. Portable core owns no platform timers. */
  readonly deadlineScheduler?: DelayScheduler;
  readonly freshnessScheduler?: FreshnessScheduler;
  /** Defaults to freshnessScheduler when supplied; zero/disabled retention needs no clock. */
  readonly retentionScheduler?: MonotonicScheduler;
  /** Inactive scheduling failed and the cache was evicted. Reporting cannot disrupt cleanup. */
  readonly onRetentionError?: (error: unknown, stateAddress: string) => void;
}

/** Immutable client policy; each call owns an independent, bounded attempt count. */
export class ReadRetrier {
  private readonly retries: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly scheduler: RetryScheduler | undefined;
  constructor(options: AcquisitionClientOptions) {
    const policy = options.retry || undefined;
    this.retries = policy ? (policy.retries ?? 2) : 0;
    this.initialDelayMs = policy?.initialDelayMs ?? 250;
    this.maxDelayMs = policy?.maxDelayMs ?? 30000;
    if (
      !Number.isInteger(this.retries) ||
      this.retries < 0 ||
      this.retries > 10
    )
      throw new Error('retries must be an integer from zero to ten.');
    for (const delay of [this.initialDelayMs, this.maxDelayMs])
      if (!Number.isInteger(delay) || delay < 0 || delay > 2_147_483_647)
        throw new Error(
          'Retry delays must be integer milliseconds from zero to 2147483647.',
        );
    if (this.initialDelayMs > this.maxDelayMs)
      throw new Error('initialDelayMs must not exceed maxDelayMs.');
    if (this.retries && !options.scheduler)
      throw new Error('Portable retries require a RetryScheduler.');
    this.scheduler = options.scheduler
      ? {
          wait: options.scheduler.wait.bind(options.scheduler),
          random: options.scheduler.random.bind(options.scheduler),
        }
      : undefined;
  }
  async read<T>(
    read: () => Promise<T>,
    signal: CancellationSignal,
    current: () => boolean,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw signal.reason;
      if (attempt && !current()) throw new AcquisitionSupersededError();
      try {
        return await cancellable(Promise.resolve(read()), signal);
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (
          !(error instanceof ReadTransportError) ||
          !error.retryable ||
          attempt >= this.retries ||
          (error.retryAfterMs ?? 0) > this.maxDelayMs
        )
          throw error;
        if (!current()) throw new AcquisitionSupersededError();
        let delay: number;
        try {
          const sample = this.scheduler!.random();
          if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
            throw new Error('Retry random() must return a sample in [0, 1).');
          const ceiling = Math.min(
            this.maxDelayMs,
            this.initialDelayMs * 2 ** attempt,
          );
          delay = Math.max(
            Math.floor(ceiling * sample),
            error.retryAfterMs ?? 0,
          );
          await cancellable(this.scheduler!.wait(delay, signal), signal);
        } catch (schedulerError) {
          if (
            signal.aborted ||
            schedulerError instanceof AcquisitionCancelledError
          )
            throw signal.reason ?? schedulerError;
          // Scheduler failures are configuration/runtime failures, not source failures.
          throw new Error('Retry scheduler failed.', { cause: schedulerError });
        }
      }
    }
  }
}

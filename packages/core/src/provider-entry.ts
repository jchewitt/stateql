import { Cancellation } from './cancellation.js';
import { assertNonThenable } from './provider.js';
import type {
  ProviderCleanup,
  ProviderFactoryContext,
  RegistrationMetadata,
} from './provider.js';

/** One initialization and cleanup journal; no dependency resolution or transport. */
export class ProviderEntry {
  private state: 'idle' | 'pending' | 'ready' | 'failed';
  private value: unknown;
  private error: unknown;
  private stopped = false;
  private readonly lifetime = new Cancellation();
  private readonly cleanups: ProviderCleanup[] = [];
  private cleanupWork = Promise.resolve();
  private work = Promise.resolve();
  private result: Promise<unknown> | undefined;
  private reject: ((error: unknown) => void) | undefined;
  private config: RegistrationMetadata | undefined;
  readonly cleanupErrors: unknown[] = [];
  constructor(
    config: RegistrationMetadata,
    private readonly claim: (value: unknown) => void,
  ) {
    this.config = config;
    this.state = config.kind === 'value' ? 'ready' : 'idle';
    if (config.kind === 'value') {
      this.value = config.value;
      if (config.dispose)
        this.cleanups.push(() => config.dispose!(config.value));
    }
  }
  get(): unknown {
    if (this.state === 'failed') throw this.error;
    if (this.state !== 'ready')
      throw new Error(
        `Provider ${this.config!.description} is not ready; await resolve() first.`,
      );
    return this.value;
  }
  resolve(): Promise<unknown> {
    if (this.result) return this.result;
    if (this.state === 'ready') {
      assertNonThenable(this.value);
      return Promise.resolve(this.value);
    }
    const config = this.config!;
    this.state = 'pending';
    let accept!: (value: unknown) => void;
    this.result = new Promise((resolve, reject) => {
      accept = resolve;
      this.reject = reject;
    });
    // The registry observes failures even if an abandoned caller ignores its promise.
    void this.result.catch(() => {});
    this.work = Promise.resolve().then(async () => {
      try {
        if (this.stopped) return;
        const value = await config.factory!(this.factoryContext());
        if (config.dispose) {
          this.claim(value);
          this.cleanups.push(() => config.dispose!(value));
        }
        if (this.stopped) return;
        if (!config.validate(value))
          throw new Error(`Provider does not satisfy ${config.description}.`);
        if (this.stopped) return;
        assertNonThenable(value);
        this.value = value;
        this.state = 'ready';
        accept(value);
      } catch (error) {
        this.error = error;
        this.state = 'failed';
        this.lifetime.abort('Provider initialization failed.');
        this.drain();
        await this.cleanupWork;
        this.error = this.cleanupErrors.length
          ? new AggregateError(
              [error, ...this.cleanupErrors],
              `Provider ${config.description} initialization failed.`,
              { cause: error },
            )
          : error;
        this.reject!(this.error);
      } finally {
        if (this.stopped) {
          this.state = 'failed';
          this.drain();
          await this.cleanupWork;
        }
      }
    });
    return this.result;
  }
  private factoryContext(): ProviderFactoryContext {
    // Isolate this callback from the initialization closure and its returned value.
    return Object.freeze({
      signal: this.lifetime.signal,
      onCleanup: (cleanup: ProviderCleanup) => {
        if (this.state !== 'pending')
          throw new Error('Provider initialization has already settled.');
        if (typeof cleanup !== 'function')
          throw new Error('Provider cleanup must be a function.');
        this.cleanups.push(cleanup);
        if (this.stopped) this.drain();
      },
    });
  }
  private drain(): void {
    const pending = this.cleanups.splice(0).reverse();
    this.cleanupWork = this.cleanupWork.then(async () => {
      for (const cleanup of pending) {
        try {
          await cleanup();
        } catch (error) {
          this.cleanupErrors.push(error);
        }
      }
    });
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    // Settle before invoking cancellation listeners, which may reenter the scope.
    this.error = new Error('Provider scope is disposed.');
    this.reject?.(this.error);
    this.lifetime.abort('Provider scope is disposed.');
    this.drain();
  }
  async finished(): Promise<void> {
    await this.work;
    await this.cleanupWork;
    this.value = undefined;
    this.result = undefined;
    this.reject = undefined;
    this.config = undefined;
    this.error = undefined;
  }
}

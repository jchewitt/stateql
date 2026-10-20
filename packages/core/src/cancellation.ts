/** Portable cancellation; adapters bridge this to their platform's signal API. */
export interface CancellationSignal {
  readonly aborted: boolean;
  readonly reason: AcquisitionCancelledError | undefined;
  subscribe(listener: () => void): () => void;
}
export class AcquisitionCancelledError extends Error {
  override readonly name = 'AcquisitionCancelledError';
}
export class AcquisitionSupersededError extends Error {
  override readonly name = 'AcquisitionSupersededError';
  constructor() {
    super(
      'Acquisition was superseded by newer work; ensure() can acquire remaining fields.',
    );
  }
}

export class Cancellation {
  private reason: AcquisitionCancelledError | undefined;
  private readonly listeners = new Set<() => void>();
  readonly signal: CancellationSignal;
  constructor() {
    const owner = this;
    this.signal = Object.freeze({
      get aborted() {
        return owner.reason !== undefined;
      },
      get reason() {
        return owner.reason;
      },
      subscribe(listener: () => void) {
        if (owner.reason) {
          listener();
          return () => {};
        }
        const registration = () => listener();
        owner.listeners.add(registration);
        return () => {
          owner.listeners.delete(registration);
        };
      },
    });
  }
  abort(message: string): void {
    if (this.reason) return;
    this.reason = new AcquisitionCancelledError(message);
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        /* One adapter cannot prevent other cleanup. */
      }
    }
    this.listeners.clear();
  }
}

/** Settle promptly even when an adapter ignores cancellation; consume late rejection. */
export function cancellable<T>(
  work: Promise<T>,
  signal: CancellationSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let unsubscribe = () => {};
    const finish = (action: () => void) => {
      unsubscribe();
      action();
    };
    unsubscribe = signal.subscribe(() => finish(() => reject(signal.reason)));
    work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

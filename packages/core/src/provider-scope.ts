import { ProviderEntry } from './provider-entry.js';
import {
  registrationMetadata,
  tokenMetadata,
  type ProviderRegistration,
  type ProviderToken,
} from './provider.js';

export interface ProviderScope {
  resolve<T>(token: ProviderToken<T>): Promise<T>;
  /** Ready instances only; never starts a factory. */
  get<T>(token: ProviderToken<T>): T;
  /** Seals immediately; await all owned cleanup, including late factory results. */
  dispose(): Promise<void>;
}

export function createProviderScope(
  registrations: readonly ProviderRegistration[],
): ProviderScope {
  // Reject structural errors before ownership transfers or any user factory runs.
  const configs = Array.from(registrations, registrationMetadata);
  const tokens = new Set<object>();
  const owned = new Set<unknown>();
  const claim = (value: unknown) => {
    if (owned.has(value))
      throw new Error(
        'A provider value may have only one owning registration per scope.',
      );
    owned.add(value);
  };
  for (const config of configs) {
    if (tokens.has(config.token))
      throw new Error(`Duplicate provider token: ${config.description}.`);
    tokens.add(config.token);
    if (config.kind === 'value' && config.dispose) claim(config.value);
  }
  const entries = new Map(
    configs.map((config) => [config.token, new ProviderEntry(config, claim)]),
  );
  let closed = false;
  let disposal: Promise<void> | undefined;
  const entry = (token: object) => {
    if (closed) throw new Error('Provider scope is disposed.');
    const metadata = tokenMetadata(token);
    const found = entries.get(token);
    if (!found)
      throw new Error(`Provider is not registered: ${metadata.description}.`);
    return found;
  };
  return Object.freeze({
    resolve<T>(token: ProviderToken<T>): Promise<T> {
      try {
        return entry(token).resolve() as Promise<T>;
      } catch (error) {
        return Promise.reject(error);
      }
    },
    get<T>(token: ProviderToken<T>): T {
      return entry(token).get() as T;
    },
    dispose(): Promise<void> {
      if (disposal) return disposal;
      closed = true;
      let finish!: () => void;
      let fail!: (error: unknown) => void;
      disposal = new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      void disposal.catch(() => {});
      const all = [...entries.values()].reverse();
      for (const value of all) value.stop();
      void Promise.all(all.map((value) => value.finished())).then(() => {
        const errors = all.flatMap((value) => value.cleanupErrors);
        entries.clear();
        owned.clear();
        if (errors.length)
          fail(new AggregateError(errors, 'Provider cleanup failed.'));
        else finish();
      }, fail);
      return disposal;
    },
  });
}

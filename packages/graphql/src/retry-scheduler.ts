import type { RetryScheduler, FreshnessScheduler } from '@tandrove/core';

/** Platform timers are confined to the assembled GraphQL client. */
export const defaultRetryScheduler: RetryScheduler & FreshnessScheduler = {
  now: () => performance.now(),
  random: () => Math.random(),
  wait: (delayMs, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const timer = setTimeout(() => {
        unsubscribe();
        resolve();
      }, delayMs);
      const unsubscribe = signal.subscribe(() => {
        clearTimeout(timer);
        reject(signal.reason);
      });
    }),
};

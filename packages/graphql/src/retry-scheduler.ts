import type { RetryScheduler } from '@tandrove/core';

/** Platform timers are confined to the assembled GraphQL client. */
export const defaultRetryScheduler: RetryScheduler = {
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

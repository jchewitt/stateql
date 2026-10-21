import {
  DestroyRef,
  inject,
  makeEnvironmentProviders,
  type EnvironmentProviders,
  type InjectionToken,
} from '@angular/core';
import type { Disposable } from '@launch-echo/stateql-core';

/** Own one lazily created client per providing environment injector. */
export function provideStateQLClient<T extends Disposable>(
  token: InjectionToken<T>,
  create: () => NoInfer<T>,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: token,
      useFactory: () => {
        const lifetime = inject(DestroyRef);
        if (lifetime.destroyed)
          throw new Error('StateQL client scope is destroyed.');
        const client = create();
        let disposed = false;
        const dispose = () => {
          if (disposed) return;
          disposed = true;
          client.dispose();
        };
        try {
          if (lifetime.destroyed)
            throw new Error(
              'StateQL client scope was destroyed during creation.',
            );
          lifetime.onDestroy(dispose);
        } catch (error) {
          dispose();
          throw error;
        }
        return client;
      },
    },
  ]);
}

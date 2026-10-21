import {
  DestroyRef,
  inject,
  makeEnvironmentProviders,
  type EnvironmentProviders,
  type InjectionToken,
} from '@angular/core';
import type { Disposable } from '@tandrove/core';

/** Own one lazily created client per providing environment injector. */
export function provideTandroveClient<T extends Disposable>(
  token: InjectionToken<T>,
  create: () => NoInfer<T>,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: token,
      useFactory: () => {
        const lifetime = inject(DestroyRef);
        if (lifetime.destroyed)
          throw new Error('Tandrove client scope is destroyed.');
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
              'Tandrove client scope was destroyed during creation.',
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

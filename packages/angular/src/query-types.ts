import type { Injector, Signal } from '@angular/core';
import type {
  InvalidateOptions,
  PollOptions,
  QuerySnapshot,
  Unsubscribe,
} from '@tandrove/core';

export type StateQueryState =
  | { readonly status: 'pending' | 'disposed' }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'active';
      readonly stateAddress: string;
      readonly snapshot: QuerySnapshot;
    };

export interface StateQueryOptions {
  /** Defaults to the current injection context and its DestroyRef. */
  readonly injector?: Injector;
}

export interface StateQuery<Target extends string = string> {
  readonly state: Signal<StateQueryState>;
  ensure(): Promise<void>;
  invalidate(target?: Target, options?: InvalidateOptions): Promise<void>;
  refresh(target?: Target): Promise<void>;
  refreshList(): Promise<void>;
  /** Registers polling on the current handle; replacement never transfers the interest. */
  poll(options?: PollOptions<Target>): Unsubscribe;
  dispose(): void;
}

import type { Injector, Signal } from '@angular/core';
import type {
  InputObject,
  InvalidateOptions,
  PollOptions,
  QuerySnapshot,
  Unsubscribe,
} from '@tandrove/core';

export type StateQueryState<Result = InputObject> = StateQueryStateFor<
  QuerySnapshot<Result>
>;
type StateQueryStateFor<Snapshot> =
  | { readonly status: 'pending' | 'disposed' }
  | { readonly status: 'error'; readonly error: unknown }
  | {
      readonly status: 'active';
      readonly stateAddress: string;
      readonly snapshot: Snapshot;
    };

export interface StateQueryOptions {
  /** Defaults to the current injection context and its DestroyRef. */
  readonly injector?: Injector;
}

export type StateQuery<
  Target extends string = string,
  Result = InputObject,
> = StateQueryFor<Target, StateQueryState<Result>>;
interface StateQueryFor<Target extends string, State> {
  readonly state: Signal<State>;
  ensure(): Promise<void>;
  invalidate(target?: Target, options?: InvalidateOptions): Promise<void>;
  refresh(target?: Target): Promise<void>;
  refreshList(): Promise<void>;
  /** Registers polling on the current handle; replacement never transfers the interest. */
  poll(options?: PollOptions<Target>): Unsubscribe;
  dispose(): void;
}

/** Releases one subscription. Calling it again must have no effect. */
export type Unsubscribe = () => void;

/**
 * Portable observation contract used by framework adapters.
 * Implementations must return immutable snapshots with stable reference identity
 * until relevant state changes. Reads must not initiate network work.
 * Subscribe notifies after a committed change; consumers then read the snapshot.
 */
export interface StoreReader<TSnapshot> {
  getSnapshot(): TSnapshot;
  subscribe(onChange: () => void): Unsubscribe;
}

/** Releases an owner's resources. Implementations must tolerate repeated calls. */
export interface Disposable {
  dispose(): void;
}

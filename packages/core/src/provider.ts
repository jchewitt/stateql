import type { CancellationSignal } from './cancellation.js';

declare const tokenType: unique symbol;
declare const registrationType: unique symbol;
/** Identity is the token object, never its diagnostic description. */
export interface ProviderToken<T> {
  readonly description: string;
  readonly [tokenType]: (value: T) => T;
}
export type ProviderCleanup = () => void | Promise<void>;
export interface ProviderFactoryContext {
  readonly signal: CancellationSignal;
  /** Register private allocations before an await that might fail. */
  onCleanup(cleanup: ProviderCleanup): void;
}
type Ownership<T> =
  | { readonly ownership?: 'borrowed'; readonly dispose?: never }
  | {
      readonly ownership: 'owned';
      readonly dispose: (value: T) => void | Promise<void>;
    };
export type ProviderOptions<T> = Ownership<T> &
  (
    | { readonly useValue: T; readonly useFactory?: never }
    | {
        readonly useFactory: (
          context: ProviderFactoryContext,
        ) => T | PromiseLike<T>;
        readonly useValue?: never;
      }
  );
export interface ProviderRegistration {
  readonly [registrationType]: true;
}
interface TokenMetadata {
  readonly description: string;
  readonly validate: (value: unknown) => boolean;
}
export interface RegistrationMetadata extends TokenMetadata {
  readonly token: object;
  readonly kind: 'value' | 'factory';
  readonly value: unknown;
  readonly factory: ((context: ProviderFactoryContext) => unknown) | undefined;
  readonly dispose: ((value: unknown) => void | Promise<void>) | undefined;
}
const tokens = new WeakMap<object, TokenMetadata>();
const registrations = new WeakMap<object, RegistrationMetadata>();

export function assertNonThenable(value: unknown): void {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  )
    throw new Error(
      'Provider values must not be promises or thenables; useFactory may return a promise of a value.',
    );
}

export function createProviderToken<T>(
  description: string,
  validate: (value: unknown) => value is T,
): ProviderToken<T> {
  if (typeof description !== 'string' || !description.trim())
    throw new Error('Provider tokens require a nonempty description.');
  if (typeof validate !== 'function')
    throw new Error('Provider tokens require a capability validator.');
  const token = Object.freeze({ description }) as ProviderToken<T>;
  tokens.set(token, { description, validate });
  return token;
}
export function tokenMetadata(token: object): TokenMetadata {
  const metadata = tokens.get(token);
  if (!metadata)
    throw new Error('Expected a token from createProviderToken().');
  return metadata;
}
export function registrationMetadata(
  registration: ProviderRegistration,
): RegistrationMetadata {
  const metadata = registrations.get(registration);
  if (!metadata) throw new Error('Expected a registration from provide().');
  return metadata;
}

/** Capture registration settings; the supplied infrastructure remains mutable. */
export function provide<T>(
  token: ProviderToken<T>,
  options: ProviderOptions<NoInfer<T>>,
): ProviderRegistration {
  const metadata = tokenMetadata(token);
  if (!options || typeof options !== 'object')
    throw new Error('Expected provider options.');
  for (const key of Object.keys(options))
    if (!['useValue', 'useFactory', 'ownership', 'dispose'].includes(key))
      throw new Error(`Unknown provider option: ${key}.`);
  const hasValue = Object.hasOwn(options, 'useValue');
  const hasFactory = Object.hasOwn(options, 'useFactory');
  if (hasValue === hasFactory)
    throw new Error('Provide exactly one of useValue or useFactory.');
  const factory = options.useFactory;
  if (hasFactory && typeof factory !== 'function')
    throw new Error('useFactory must be a function.');
  const ownership = options.ownership ?? 'borrowed';
  const dispose = options.dispose;
  if (
    (ownership !== 'owned' && ownership !== 'borrowed') ||
    (ownership === 'owned' && typeof dispose !== 'function') ||
    (ownership === 'borrowed' && dispose !== undefined)
  )
    throw new Error(
      'Owned providers require dispose; borrowed providers cannot dispose their value.',
    );
  const value = options.useValue;
  if (hasValue) assertNonThenable(value);
  if (hasValue && !metadata.validate(value))
    throw new Error(`Provider does not satisfy ${metadata.description}.`);
  const registration = Object.freeze({}) as ProviderRegistration;
  registrations.set(registration, {
    ...metadata,
    token,
    kind: hasValue ? 'value' : 'factory',
    value,
    factory,
    dispose: dispose ? (value: unknown) => dispose(value as T) : undefined,
  });
  return registration;
}

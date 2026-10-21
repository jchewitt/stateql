export interface FreshnessPolicy {
  /** Age of accepted coverage in milliseconds; false disables expiry. Zero is on-demand only. */
  readonly staleTimeMs?: number | false;
  readonly revalidate?: 'on-demand' | 'active';
}
/** Shared acquisition lifecycle policies. Freshness and request deadlines are independent. */
export interface RequestPolicy {
  /** Total milliseconds across a request's attempts/backoff. Omitted inherits; false disables. */
  readonly requestTimeoutMs?: number | false;
  readonly freshness?: FreshnessPolicy;
}
export interface RequestPolicyConfiguration {
  readonly requestPolicy?: RequestPolicy;
  readonly requestPolicyGroups?: Readonly<Record<string, RequestPolicy>>;
}
/** Immutable resource binding, shared by every consumer of its state address. */
export interface ResourceRequestOptions {
  readonly group?: string;
  readonly requestPolicy?: RequestPolicy;
}
export interface ResolvedRequestPolicy {
  readonly requestTimeoutMs: number | false;
  readonly freshness: Required<FreshnessPolicy>;
}

export function validateRequestTimeout(
  value: unknown,
): asserts value is number | false {
  if (
    value !== false &&
    (!Number.isInteger(value) ||
      (value as number) < 1 ||
      (value as number) > 2_147_483_647)
  )
    throw new Error(
      'requestTimeoutMs must be false or integer milliseconds from 1 to 2147483647.',
    );
}

function capture(policy: RequestPolicy = {}): Readonly<RequestPolicy> {
  if (
    policy === null ||
    typeof policy !== 'object' ||
    Array.isArray(policy) ||
    Object.keys(policy).some(
      (key) => key !== 'requestTimeoutMs' && key !== 'freshness',
    )
  )
    throw new Error(
      'Request policy supports only requestTimeoutMs and freshness.',
    );
  const value = policy.requestTimeoutMs;
  if (value !== undefined) validateRequestTimeout(value);
  const freshness = policy.freshness;
  if (freshness !== undefined) {
    if (
      freshness === null ||
      typeof freshness !== 'object' ||
      Array.isArray(freshness) ||
      Object.keys(freshness).some(
        (key) => key !== 'staleTimeMs' && key !== 'revalidate',
      )
    )
      throw new Error(
        'Freshness policy supports only staleTimeMs and revalidate.',
      );
    const age = freshness.staleTimeMs;
    if (
      age !== undefined &&
      age !== false &&
      (!Number.isInteger(age) || age < 0 || age > 2_147_483_647)
    )
      throw new Error(
        'staleTimeMs must be false or integer milliseconds from 0 to 2147483647.',
      );
    if (
      freshness.revalidate !== undefined &&
      freshness.revalidate !== 'on-demand' &&
      freshness.revalidate !== 'active'
    )
      throw new Error('Freshness revalidate must be on-demand or active.');
  }
  return Object.freeze({
    ...(value === undefined ? {} : { requestTimeoutMs: value }),
    ...(freshness === undefined
      ? {}
      : { freshness: Object.freeze({ ...freshness }) }),
  });
}

/** Capture caller configuration once; group labels never enter resource identity. */
export class RequestPolicies {
  private readonly defaults: Readonly<RequestPolicy>;
  private readonly groups = new Map<string, Readonly<RequestPolicy>>();
  constructor(options: RequestPolicyConfiguration) {
    this.defaults = capture(options.requestPolicy);
    if (options.requestPolicyGroups !== undefined) {
      const groups = options.requestPolicyGroups;
      if (
        groups === null ||
        typeof groups !== 'object' ||
        Array.isArray(groups)
      )
        throw new Error('requestPolicyGroups must be a named policy map.');
      for (const [name, policy] of Object.entries(groups)) {
        if (!name.trim())
          throw new Error('Request policy group names must not be empty.');
        this.groups.set(name, capture(policy));
      }
    }
  }
  resolve(options: ResourceRequestOptions = {}): ResolvedRequestPolicy {
    const group =
      options.group === undefined ? undefined : this.groups.get(options.group);
    if (options.group !== undefined && !group)
      throw new Error('Unknown request policy group: ' + String(options.group));
    const override = capture(options.requestPolicy);
    const freshness = Object.freeze({
      staleTimeMs:
        override.freshness?.staleTimeMs ??
        group?.freshness?.staleTimeMs ??
        this.defaults.freshness?.staleTimeMs ??
        false,
      revalidate:
        override.freshness?.revalidate ??
        group?.freshness?.revalidate ??
        this.defaults.freshness?.revalidate ??
        'on-demand',
    });
    if (freshness.staleTimeMs === 0 && freshness.revalidate === 'active')
      throw new Error(
        'Active freshness revalidation requires a positive staleTimeMs or false.',
      );
    return Object.freeze({
      freshness,
      requestTimeoutMs:
        override.requestTimeoutMs ??
        group?.requestTimeoutMs ??
        this.defaults.requestTimeoutMs ??
        false,
    });
  }
}

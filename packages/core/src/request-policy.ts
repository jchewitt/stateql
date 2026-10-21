/** Shared acquisition policy. Cache freshness and retention are separate concerns. */
export interface RequestPolicy {
  /** Total milliseconds across a request's attempts/backoff. Omitted inherits; false disables. */
  readonly requestTimeoutMs?: number | false;
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
    Object.keys(policy).some((key) => key !== 'requestTimeoutMs')
  )
    throw new Error('Request policy supports only requestTimeoutMs.');
  const value = policy.requestTimeoutMs;
  if (value === undefined) return Object.freeze({});
  validateRequestTimeout(value);
  return Object.freeze({ requestTimeoutMs: value });
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
    return Object.freeze({
      requestTimeoutMs:
        override.requestTimeoutMs ??
        group?.requestTimeoutMs ??
        this.defaults.requestTimeoutMs ??
        false,
    });
  }
}

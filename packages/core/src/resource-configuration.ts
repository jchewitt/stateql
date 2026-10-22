import { tokenMetadata, type ProviderToken } from './provider.js';
import type { ProviderScope } from './provider-scope.js';
import {
  RequestPolicies,
  type RequestPolicy,
  type RequestPolicyConfiguration,
  type ResourceRequestOptions,
} from './request-policy.js';

export type ProviderAssignments<C> = {
  readonly [K in keyof C]?: ProviderToken<C[K]> | false;
};
export interface ResourceGroup<C> {
  readonly providers?: ProviderAssignments<C>;
  readonly requestPolicy?: RequestPolicy;
}
export interface ResourceConfigurationOptions<C>
  extends RequestPolicyConfiguration, ResourceGroup<C> {
  /** Borrowed infrastructure; resolve asynchronous factories during bootstrap. */
  readonly providerScope?: ProviderScope;
  readonly resourceGroups?: Readonly<Record<string, ResourceGroup<C>>>;
}
export interface ResourceOptions<C> extends ResourceRequestOptions {
  readonly providers?: ProviderAssignments<C>;
}
export type CapabilityValidators<C> = {
  readonly [K in keyof C]: (value: unknown) => value is C[K];
};
type ResolvedProviders<C> = { readonly [K in keyof C]?: C[K] | false };

function objectMap(value: unknown, label: string): asserts value is object {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
}

/** Portable assignment resolution, independent of provider initialization/ownership. */
export class ResourceConfiguration<C> {
  private readonly defaults: ProviderAssignments<C>;
  private readonly groups = new Map<string, ProviderAssignments<C>>();
  private readonly policies: RequestPolicies;
  private readonly validators: CapabilityValidators<C>;
  private readonly get: ProviderScope['get'] | undefined;

  constructor(
    options: ResourceConfigurationOptions<C>,
    validators: CapabilityValidators<C>,
  ) {
    this.validators = Object.freeze({ ...validators });
    const scope = options.providerScope;
    if (scope !== undefined && (!scope || typeof scope.get !== 'function'))
      throw new Error('providerScope requires ready-only get().');
    this.get = scope?.get.bind(scope);
    this.defaults = this.capture(options.providers);
    const policies: Record<string, RequestPolicy> = Object.create(null);
    if (options.requestPolicyGroups !== undefined) {
      objectMap(options.requestPolicyGroups, 'requestPolicyGroups');
      for (const [name, policy] of Object.entries(
        options.requestPolicyGroups,
      )) {
        policies[name] = policy;
        this.groups.set(name, Object.freeze({}));
      }
    }
    if (options.resourceGroups !== undefined) {
      objectMap(options.resourceGroups, 'resourceGroups');
      for (const [name, group] of Object.entries(options.resourceGroups)) {
        if (this.groups.has(name))
          throw new Error(
            `Group ${name} is declared in both resourceGroups and requestPolicyGroups.`,
          );
        objectMap(group, `Resource group ${name}`);
        for (const key of Object.keys(group))
          if (key !== 'providers' && key !== 'requestPolicy')
            throw new Error(`Unknown resource group option: ${key}.`);
        this.groups.set(name, this.capture(group.providers));
        policies[name] =
          group.requestPolicy === undefined ? {} : group.requestPolicy;
      }
    }
    this.policies = new RequestPolicies({
      ...(options.requestPolicy === undefined
        ? {}
        : { requestPolicy: options.requestPolicy }),
      requestPolicyGroups: policies,
    });
  }

  private capture(input: ProviderAssignments<C> = {}): ProviderAssignments<C> {
    objectMap(input, 'providers');
    const result: Partial<Record<keyof C, ProviderToken<C[keyof C]> | false>> =
      Object.create(null);
    for (const key of Object.keys(input) as (keyof C)[]) {
      if (!Object.hasOwn(this.validators, key))
        throw new Error(`Unsupported provider capability: ${String(key)}.`);
      const token = input[key];
      if (token === undefined) continue;
      if (token !== false) {
        tokenMetadata(token);
        if (!this.get)
          throw new Error('Provider assignments require providerScope.');
      }
      result[key] = token;
    }
    return Object.freeze(result) as ProviderAssignments<C>;
  }

  resolve(options: ResourceOptions<C> = {}) {
    objectMap(options, 'Resource options');
    for (const key of Object.keys(options))
      if (key !== 'group' && key !== 'providers' && key !== 'requestPolicy')
        throw new Error(`Unknown resource option: ${key}.`);
    const requestPolicy = this.policies.resolve(options);
    const group =
      options.group === undefined ? undefined : this.groups.get(options.group);
    const overrides = this.capture(options.providers);
    const providers: Partial<Record<keyof C, C[keyof C] | false>> =
      Object.create(null);
    for (const key of Object.keys(this.validators) as (keyof C)[]) {
      const token = overrides[key] ?? group?.[key] ?? this.defaults[key];
      if (token === undefined) continue;
      if (token === false) {
        providers[key] = false;
        continue;
      }
      const value = this.get!(token);
      if (!this.validators[key](value))
        throw new Error(
          `Provider ${token.description} does not satisfy capability ${String(key)}.`,
        );
      providers[key] = value;
    }
    return Object.freeze({
      requestPolicy,
      providers: Object.freeze(providers) as ResolvedProviders<C>,
    });
  }
}

import {
  AcquisitionClient,
  type AcquisitionSource,
  type DelayScheduler,
  type RequestPolicy,
  type ResourceRequestOptions,
  type FreshnessScheduler,
  type FreshnessPolicy,
} from '../src/index.js';

declare const source: AcquisitionSource;
declare const clock: DelayScheduler;
const policy: RequestPolicy = { requestTimeoutMs: 100 };
const client = new AcquisitionClient({
  requestPolicy: policy,
  deadlineScheduler: clock,
  requestPolicyGroups: { forms: { requestTimeoutMs: false } },
});
const binding: ResourceRequestOptions = {
  group: 'forms',
  requestPolicy: { requestTimeoutMs: 200 },
};
client.watch(source, binding);
// @ts-expect-error Durations have explicit numeric milliseconds, not strings.
client.watch(source, { requestPolicy: { requestTimeoutMs: '1s' } });
// @ts-expect-error false is the explicit disabling value.
const invalid: RequestPolicy = { requestTimeoutMs: true };
void invalid;
declare const freshnessScheduler: FreshnessScheduler;
const freshness: FreshnessPolicy = { staleTimeMs: 100, revalidate: 'active' };
new AcquisitionClient({
  freshnessScheduler,
  requestPolicy: { freshness },
}).watch(source, { requestPolicy: { freshness: { staleTimeMs: false } } });
// @ts-expect-error Unknown revalidation modes must not silently schedule reads.
const badFreshness: FreshnessPolicy = { revalidate: 'always' };
void badFreshness;

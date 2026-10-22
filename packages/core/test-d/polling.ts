import {
  AcquisitionClient,
  type AcquisitionSource,
  type MonotonicScheduler,
  type QueryHandle,
  type RequestPolicy,
} from '../src/index.js';

declare const scheduler: MonotonicScheduler;
declare const source: AcquisitionSource;
declare const typed: QueryHandle<'name' | 'billing.accountId'>;
const policy: RequestPolicy = { polling: { everyMs: 100 } };
const client = new AcquisitionClient({
  pollingScheduler: scheduler,
  requestPolicy: policy,
  resourceGroups: { forms: { requestPolicy: { polling: { everyMs: false } } } },
});
const handle = client.watch(source, {
  group: 'forms',
  requestPolicy: { polling: { everyMs: 50 } },
});
const stop: () => void = handle.poll({ everyMs: 25 });
stop();
typed.poll({ target: 'billing.accountId', everyMs: 100 });
typed.poll({ target: 'name' });
typed.poll({ everyMs: false });
typed.poll();
// @ts-expect-error Polling targets retain the query's selected field paths.
typed.poll({ target: 'missing', everyMs: 100 });
// @ts-expect-error Polling uses explicit numeric milliseconds, not durations as text.
typed.poll({ everyMs: '1s' });
// @ts-expect-error false is the explicit disabling value.
const badPolicy: RequestPolicy = { polling: { everyMs: true } };
void badPolicy;
// @ts-expect-error A polling clock needs monotonic now() as well as wait().
new AcquisitionClient({ pollingScheduler: { wait: scheduler.wait } });

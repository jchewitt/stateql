import assert from 'node:assert/strict';
import {
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { StateStore, resourceAddress } from '@jchewitt/stateql-core';
import { stateqlSignal } from '@jchewitt/stateql-angular';

const store = new StateStore();
const address = resourceAddress({ source: 'packed', scope: 'A' }, [
  { name: 'invoice', arguments: {} },
]);
const view = store.watch(address, [
  { name: 'name', responseName: 'name', arguments: {}, children: [] },
]);
const injector = createEnvironmentInjector([]);
const snapshot = runInInjectionContext(injector, () => stateqlSignal(view));
const write = (value) => ({
  kind: 'write',
  record: { id: '1' },
  path: [{ name: 'name', arguments: {} }],
  value,
});
store.commit(address, [
  { kind: 'membership', records: [{ id: '1' }] },
  write('first'),
]);
assert.equal(snapshot().records[0].data.name, 'first');
assert.equal(snapshot.set, undefined);
const last = snapshot();
injector.destroy();
store.commit(address, [write('second')]);
assert.equal(snapshot(), last);
assert.equal(view.getSnapshot().records[0].data.name, 'second');
view.dispose();
store.dispose();

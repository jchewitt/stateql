import { StateStore, type InputValue } from '../src/index.js';
const store = new StateStore();
const view = store.watch('resource', [
  { name: 'name', responseName: 'label', arguments: {}, children: [] },
]);
const data: InputValue | undefined =
  view.getSnapshot().records?.[0]?.data['label'];
void data;
// @ts-expect-error snapshots cannot be mutated
view.getSnapshot().complete = true;
// @ts-expect-error selections cannot be reassigned
view.selection = [];
// @ts-expect-error field writes require canonical paths
store.commit('resource', [{ kind: 'write', record: { id: '1' }, value: 'x' }]);
store.commit('resource', [
  {
    kind: 'write',
    record: { id: '1' },
    path: [{ name: 'name', arguments: {} }],
    // @ts-expect-error opaque values must be JSON-compatible
    value: () => 1,
  },
]);

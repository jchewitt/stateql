import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DraftSession,
  SaveError,
  type DraftState,
  type EditorBinding,
  type EditorSource,
  type ServerField,
} from '../src/forms/draft.js';

const fresh = (value: string | null): ServerField => ({
  available: true,
  value,
});
const target = { tenantId: 'A' as const, id: 'INV-1' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function harness() {
  const notifications: DraftState[] = [];
  const session = new DraftSession((state) => notifications.push(state));
  session.observe(fresh('base'));
  let value = fresh('saved');
  const calls = { saves: 0, reads: 0 };
  const binding: EditorBinding = {
    read: () => value,
    subscribe: () => () => {},
    dispose() {},
    async refresh() {
      calls.reads++;
      return value;
    },
  };
  const source: EditorSource = {
    open: () => binding,
    async save() {
      calls.saves++;
    },
  };
  return {
    session,
    notifications,
    binding,
    source,
    calls,
    set: (next: ServerField) => {
      value = next;
    },
  };
}

test('two draft sessions isolate edits; pristine fields follow refresh and dirty conflicts require resolution', () => {
  const a = harness().session,
    b = harness().session;
  a.edit('local');
  assert.equal(b.state.draft, 'base');
  a.observe(fresh('server'));
  b.observe(fresh('server'));
  assert.equal(a.state.draft, 'local');
  assert.equal(a.state.conflict, true);
  assert.equal(a.state.canSave, false);
  assert.equal(b.state.draft, 'server');
  assert.equal(b.state.dirty, false);
  a.resolve(false);
  assert.equal(a.state.baseline, 'server');
  assert.equal(a.state.draft, 'local');
  assert.equal(a.state.canSave, true);
  a.observe(fresh('newest'));
  a.resolve(true);
  assert.equal(a.state.draft, 'newest');
  assert.equal(a.state.dirty, false);
});

test('null, empty input, missing fields and stale data remain distinct', () => {
  const { session } = harness();
  session.edit('');
  assert.equal(session.state.canSave, false);
  session.edit('x'.repeat(81));
  assert.equal(session.state.canSave, false);
  session.edit(null);
  assert.equal(session.state.canSave, true);
  session.observe({ available: false, reason: 'Field failed' });
  assert.equal(session.state.draft, null);
  assert.equal(session.state.canSave, false);
  session.resolve(true);
  assert.equal(session.state.draft, null);
  session.observe(fresh(null));
  assert.equal(session.state.conflict, false);
  session.resolve(true);
  assert.equal(session.state.dirty, false);
  assert.equal(session.state.latest, null);
});

test('save captures its target and value, blocks duplicate commands, and preserves newer edits', async () => {
  const h = harness(),
    ack = deferred<void>();
  let captured: unknown;
  h.source.save = async (scope, value) => {
    captured = { scope, value };
    h.calls.saves++;
    await ack.promise;
  };
  const mutableTarget = { ...target };
  h.session.edit('submitted');
  h.set(fresh('submitted'));
  const saving = h.session.save(mutableTarget, h.source, h.binding);
  mutableTarget.id = 'INV-2';
  h.session.edit('later');
  await h.session.save(target, h.source, h.binding);
  assert.equal(h.calls.saves, 1);
  assert.deepEqual(captured, { scope: target, value: 'submitted' });
  // Even a matching broadcast is not a command acknowledgement.
  h.session.observe(fresh('submitted'));
  assert.equal(h.session.state.phase, 'saving');
  assert.equal(h.session.state.draft, 'later');
  ack.resolve();
  await saving;
  assert.equal(h.session.state.baseline, 'submitted');
  assert.equal(h.session.state.draft, 'later');
  assert.equal(h.session.state.dirty, true);
  assert.equal(h.calls.reads, 1);
});

test('confirmed save with failed refresh retries only the read and preserves subsequent edits', async () => {
  const h = harness();
  h.session.edit('submitted');
  h.binding.refresh = async () => {
    h.calls.reads++;
    if (h.calls.reads === 1) throw new Error('offline');
    return fresh('submitted');
  };
  await h.session.save(target, h.source, h.binding);
  assert.equal(h.session.state.phase, 'saved-refresh-failed');
  assert.equal(h.session.state.canSave, false);
  h.session.edit('later');
  h.session.observe(fresh('submitted'));
  assert.equal(h.session.state.draft, 'later');
  await h.session.save(target, h.source, h.binding);
  await h.session.refresh(h.binding);
  assert.equal(h.calls.saves, 1);
  assert.equal(h.calls.reads, 2);
  assert.equal(h.session.state.phase, 'saved');
  assert.equal(h.session.state.baseline, 'submitted');
  assert.equal(h.session.state.draft, 'later');
});

test('known rejection preserves draft; uncertain acknowledgement needs explicit reconciliation', async () => {
  const h = harness();
  h.session.edit('local');
  h.source.save = async () => {
    throw new SaveError('invalid', 'rejected');
  };
  await h.session.save(target, h.source, h.binding);
  assert.equal(h.session.state.phase, 'rejected');
  assert.equal(h.session.state.draft, 'local');
  assert.equal(h.session.state.canSave, true);
  h.source.save = async () => {
    throw new Error('lost connection');
  };
  await h.session.save(target, h.source, h.binding);
  assert.equal(h.session.state.phase, 'unknown');
  assert.equal(h.session.state.canSave, false);
  // An unrelated cache broadcast can repeat the pre-command value.
  h.session.observe(fresh('base'));
  assert.equal(h.session.state.canResolve, false);
  h.session.resolve(false);
  assert.equal(h.session.state.phase, 'unknown');
  h.set({ available: false, reason: 'Still offline' });
  await h.session.refresh(h.binding);
  h.session.observe(fresh('base'));
  assert.equal(h.session.state.canResolve, false);
  h.set(fresh('local'));
  await h.session.refresh(h.binding);
  assert.equal(h.session.state.phase, 'unknown');
  assert.equal(h.session.state.canSave, false);
  assert.equal(h.session.state.canResolve, true);
  h.session.resolve(true);
  assert.equal(h.session.state.phase, 'idle');
  assert.equal(h.session.state.dirty, false);
  assert.match(h.session.state.message, /acknowledgement remains unknown/);
});

test('disposed editor suppresses old outcomes but a confirmed command still refreshes captured scope', async () => {
  const h = harness(),
    ack = deferred<void>();
  h.source.save = () => ack.promise;
  h.session.edit('submitted');
  const saving = h.session.save(target, h.source, h.binding);
  h.session.dispose();
  const before = h.notifications.length;
  const replacement = harness();
  replacement.session.observe(fresh('tenant-B'));
  ack.resolve();
  await saving;
  assert.equal(h.calls.reads, 1);
  assert.equal(h.notifications.length, before);
  assert.equal(replacement.session.state.draft, 'tenant-B');
});

test('record removal preserves the draft and blocks save until fresh availability returns', async () => {
  const h = harness();
  h.session.edit('local');
  h.session.observe({ available: false, reason: 'Record missing' });
  await h.session.save(target, h.source, h.binding);
  assert.equal(h.calls.saves, 0);
  assert.equal(h.session.state.draft, 'local');
  h.set({ available: false, reason: 'Record missing' });
  await h.session.refresh(h.binding);
  assert.equal(h.session.state.available, false);
  assert.equal(h.session.state.draft, 'local');
});

test('authoritative refreshed values establish the baseline without assuming submitted values are canonical', async () => {
  const h = harness();
  h.session.edit('submitted');
  h.set(fresh('canonical'));
  await h.session.save(target, h.source, h.binding);
  assert.equal(h.session.state.draft, 'canonical');
  assert.equal(h.session.state.baseline, 'canonical');
  assert.equal(h.session.state.dirty, false);
});

test('explicit null is captured and accepted as a real saved value', async () => {
  const h = harness();
  h.session.edit(null);
  h.set(fresh(null));
  let submitted: unknown = 'not-called';
  h.source.save = async (_, value) => {
    submitted = value;
  };
  await h.session.save(target, h.source, h.binding);
  assert.equal(submitted, null);
  assert.equal(h.session.state.draft, null);
  assert.equal(h.session.state.dirty, false);
});

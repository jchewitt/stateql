import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runJavaScriptExample } from '../src/javascript.mjs';
import { runAdapterExample } from '../src/adapters.mjs';

test('native JavaScript consumer uses runtime SDL, aliases and shared narrow refreshes', async () => {
  assert.deepEqual(await runJavaScriptExample(() => {}), {
    requests: 4,
    cachedAmount: 10,
  });
});
test('fake whole-resource and event adapters share core state and protect pushed values', async () => {
  assert.deepEqual(await runAdapterExample(() => {}), {
    readsA: 3,
    readsB: 1,
    accountId: 'A-pushed',
  });
});

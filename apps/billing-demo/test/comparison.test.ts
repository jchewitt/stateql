import { test } from 'node:test';
import { compareNetwork } from '../bench/network.js';

test('comparison measures equivalent full/narrow reads and preserved siblings', async () => {
  await compareNetwork();
});

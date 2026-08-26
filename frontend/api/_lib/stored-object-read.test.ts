import assert from 'node:assert/strict';
import test from 'node:test';
import { readStoredObject } from './stored-object-read.js';

test('reads an exact stored object', async () => {
  const requested: string[] = [];
  const value = await readStoredObject('vocivo/state.bin', {
    read: async (pathname) => {
      requested.push(pathname);
      return Buffer.from('fresh state');
    },
    wait: async () => undefined,
  });

  assert.equal(value?.toString(), 'fresh state');
  assert.deepEqual(requested, ['vocivo/state.bin']);
});

test('retries a temporary stored object failure', async () => {
  let attempts = 0;
  const waits: number[] = [];
  const value = await readStoredObject('vocivo/state.bin', {
    read: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('database temporarily unavailable');
      return Buffer.from('available');
    },
    wait: async (milliseconds) => { waits.push(milliseconds); },
  });

  assert.equal(value?.toString(), 'available');
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [150, 500]);
});

test('returns null when the exact pathname does not exist', async () => {
  const value = await readStoredObject('vocivo/missing.bin', {
    read: async () => null,
    wait: async () => undefined,
  });
  assert.equal(value, null);
});

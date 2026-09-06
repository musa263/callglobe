import assert from 'node:assert/strict';
import test from 'node:test';
import { createSipDeviceIdentity, revokeBrowserSipCredential } from './sipDevice.js';

function storage(value) {
  return { getItem: () => value, setItem: (_key, next) => { value = next; } };
}

test('a duplicated browser tab gets a new identity without changing the original', async () => {
  const held = new Set();
  const locks = { request: async (id, _options, callback) => {
    const lock = held.has(id) ? null : { name: id };
    if (lock) held.add(id);
    return callback(lock);
  } };
  const first = createSipDeviceIdentity({ storage: storage('original-browser-1234'), locks, randomUUID: () => 'first-random-id-1234' });
  const duplicate = createSipDeviceIdentity({ storage: storage('original-browser-1234'), locks, randomUUID: () => 'second-random-id-5678' });
  assert.equal(await first(), 'original-browser-1234');
  assert.equal(await duplicate(), 'second-random-id-5678');
  assert.equal(await first(), 'original-browser-1234');
  assert.equal(await duplicate(), 'second-random-id-5678');
});

test('storage-denied browsers retain a unique in-memory identity for every reconnect', async () => {
  const warnings = [];
  const get = createSipDeviceIdentity({ storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }, randomUUID: () => 'private-window-12345', warn: (...args) => warnings.push(args) });
  assert.equal(await get(), 'private-window-12345');
  assert.equal(await get(), 'private-window-12345');
  assert.equal(warnings.length, 2);
});

test('web teardown names only the credential generation being closed', async () => {
  let called;
  await revokeBrowserSipCredential(async (path, options) => { called = [path, options]; }, { deviceId: 'browser-one', credentialId: 'generation-one' });
  const url = new URL(called[0], 'https://local');
  assert.equal(url.searchParams.get('deviceId'), 'browser-one');
  assert.equal(url.searchParams.get('credentialId'), 'generation-one');
  assert.equal(called[1].method, 'DELETE');
  assert.equal(called[1].keepalive, true);
});

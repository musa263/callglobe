import assert from 'node:assert/strict';
import test from 'node:test';
import { getStoredSession, storeSession } from '../lib/api.js';

test('legacy browser bearer tokens are purged and newly stored profiles contain no token', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map([['vocivo.session', JSON.stringify({ token: 'old-bearer', name: 'User' })]]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  } });
  try {
    assert.deepEqual(getStoredSession(), { name: 'User' });
    assert.equal(data.get('vocivo.session').includes('old-bearer'), false);
    storeSession({ token: 'new-bearer', name: 'User' });
    assert.deepEqual(getStoredSession(), { name: 'User' });
    assert.equal(data.get('vocivo.session').includes('bearer'), false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

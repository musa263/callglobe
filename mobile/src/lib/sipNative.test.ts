import assert from 'node:assert/strict';
import test from 'node:test';
import { onVocivoSipReady, sipClientReady, sipDomain, vocivoSipModule } from './sipNative.js';

test('native SIP module is optional until an iOS build links VocivoSip', () => {
  assert.equal(typeof sipClientReady, 'function');
  assert.equal(sipClientReady(), false);
  assert.equal(sipDomain(), '');
  assert.equal(vocivoSipModule(), null);
  let ready = true;
  const off = onVocivoSipReady((value) => { ready = value; });
  assert.equal(ready, false);
  off();
});

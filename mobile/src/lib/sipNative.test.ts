import assert from 'node:assert/strict';
import test from 'node:test';
import { onVocivoSipReady, sipClientReady, sipDomain } from './sipNative.js';

test('native SIP is not registered until an iOS build links VocivoSip', () => {
  assert.equal(sipClientReady(), false);
  assert.equal(sipDomain(), '');
  let ready = true;
  const off = onVocivoSipReady((value) => { ready = value; });
  assert.equal(ready, false);
  off();
});

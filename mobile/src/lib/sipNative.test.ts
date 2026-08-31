import assert from 'node:assert/strict';
import test from 'node:test';
import { preferredVoiceEdge, setPreferredVoiceEdge, sipClientReady, sipDomain, sipEdgeInternalCallsOnly, onVocivoSipReady } from './sipNative.js';

test('native SIP is not registered until an iOS build links VocivoSip', () => {
  assert.equal(sipClientReady(), false);
  assert.equal(sipDomain(), '');
  let ready = true;
  const off = onVocivoSipReady((value) => { ready = value; });
  assert.equal(ready, false);
  off();
});

test('SIP-edge internal calls refuse the Telnyx SDK fallback', () => {
  setPreferredVoiceEdge('sip');
  assert.equal(preferredVoiceEdge(), 'sip');
  assert.equal(sipEdgeInternalCallsOnly(), true);
  setPreferredVoiceEdge('telnyx');
  assert.equal(sipEdgeInternalCallsOnly(), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldUseSipNative, sipNativeAvailable, voiceEdgeFromConfig } from './voiceEdge.js';

test('SIP requires its native module and never selects a carrier fallback', () => {
  assert.equal(voiceEdgeFromConfig({ voice_edge: 'sip' }), 'sip');
  assert.equal(sipNativeAvailable({}), false);
  assert.equal(shouldUseSipNative('sip', {}), false);
  assert.equal(shouldUseSipNative('sip', { VocivoSip: {} }), true);
  assert.equal(shouldUseSipNative('telnyx', { VocivoSip: {} }), false);
});

test('missing or invalid server configuration cannot initialize a managed engine', () => {
  for (const config of [null, undefined, {}, { voice_edge: '' }, { voice_edge: 'invalid', provider: 'telnyx' }]) {
    assert.throws(() => voiceEdgeFromConfig(config), /configuration is unavailable/);
  }
  assert.equal(voiceEdgeFromConfig({ provider: 'telnyx' }), 'telnyx');
  assert.equal(voiceEdgeFromConfig({ voice_edge: 'telnyx', provider: 'sip' }), 'telnyx');
});

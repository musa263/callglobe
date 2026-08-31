import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldUseSipNative, sipNativeAvailable, voiceEdgeFromConfig } from './voiceEdge.js';

test('mobile uses the Vocivo SIP edge whenever voice_edge is sip', () => {
  assert.equal(voiceEdgeFromConfig({ voice_edge: 'sip' }), 'sip');
  assert.equal(sipNativeAvailable({}), false);
  assert.equal(shouldUseSipNative('sip', {}), true);
  assert.equal(shouldUseSipNative('sip', { VocivoSip: {} }), true);
  assert.equal(shouldUseSipNative('telnyx', { VocivoSip: {} }), false);
});

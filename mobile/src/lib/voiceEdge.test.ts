import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldUseSipNative, sipNativeAvailable, voiceEdgeFromConfig } from './voiceEdge.js';

test('mobile stays on Telnyx until the SIP native module is linked', () => {
  assert.equal(voiceEdgeFromConfig({ voice_edge: 'sip' }), 'sip');
  assert.equal(sipNativeAvailable({}), false);
  assert.equal(shouldUseSipNative('sip', {}), false);
  assert.equal(shouldUseSipNative('sip', { VocivoSip: {} }), true);
  assert.equal(shouldUseSipNative('telnyx', { VocivoSip: {} }), false);
});

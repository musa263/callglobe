import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldUseSipNative, sipNativeAvailable, voiceEdgeFromConfig } from './voiceEdge.js';

test('mobile uses native SIP only on iOS when the VocivoSip module is linked', () => {
  assert.equal(voiceEdgeFromConfig({ voice_edge: 'sip' }), 'sip');
  assert.equal(sipNativeAvailable({}), false);
  assert.equal(shouldUseSipNative('sip', {}, 'ios'), false);
  assert.equal(shouldUseSipNative('sip', { VocivoSip: {} }, 'ios'), true);
  assert.equal(shouldUseSipNative('sip', { VocivoSip: {} }, 'android'), false);
  assert.equal(shouldUseSipNative('telnyx', { VocivoSip: {} }, 'ios'), false);
});

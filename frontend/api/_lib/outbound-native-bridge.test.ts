import assert from 'node:assert/strict';
import test from 'node:test';
import { outboundUsesNativeBridgeOnAnswer } from './outbound-native-bridge.js';

test('native bridge follows the stored pair even if a later webhook omitted the flag', () => {
  assert.equal(outboundUsesNativeBridgeOnAnswer({ bridgeOnAnswer: true }, { flow: 'outbound_destination' }), true);
  assert.equal(outboundUsesNativeBridgeOnAnswer(null, { flow: 'outbound_destination', bridgeOnAnswer: true }), true);
  assert.equal(outboundUsesNativeBridgeOnAnswer({ bridgeOnAnswer: false }, { flow: 'outbound_destination' }), false);
  assert.equal(outboundUsesNativeBridgeOnAnswer(null, { flow: 'agent', bridgeOnAnswer: true }), false);
});

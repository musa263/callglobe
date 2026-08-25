import assert from 'node:assert/strict';
import test from 'node:test';
import { isInboundCallAnswered, isInboundCallInitiated } from './voice-routing.js';

const base = {
  connectionId: 'voice-app',
  callControlApplicationId: 'voice-app',
  to: '+18447161777',
  inboundNumber: '+18447161777',
  hasManagedState: false,
};

test('accepts a genuine inbound initiated call', () => {
  assert.equal(isInboundCallInitiated({ ...base, direction: 'incoming' }), true);
});

test('accepts an inbound answered event when Telnyx omits direction', () => {
  assert.equal(isInboundCallAnswered({ ...base, hasOutboundPair: false }), true);
});

test('rejects parked WebRTC and managed outbound call legs', () => {
  assert.equal(isInboundCallAnswered({ ...base, connectionId: 'mobile-connection', hasOutboundPair: false }), false);
  assert.equal(isInboundCallAnswered({ ...base, hasManagedState: true, hasOutboundPair: false }), false);
});

test('rejects a stateless outbound destination paired by the server', () => {
  assert.equal(isInboundCallAnswered({ ...base, hasOutboundPair: true }), false);
});

test('rejects calls that do not target the configured inbound number', () => {
  assert.equal(isInboundCallAnswered({ ...base, to: '+2347000000000', hasOutboundPair: false }), false);
});

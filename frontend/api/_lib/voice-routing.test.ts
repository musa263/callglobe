import assert from 'node:assert/strict';
import test from 'node:test';
import { isVoiceRouteId } from './voice-route-id.js';
import { isInboundCallAnswered, isInboundCallInitiated } from './voice-routing.js';

const base = {
  connectionId: 'voice-app',
  callControlApplicationId: 'voice-app',
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

test('accepts every DID assigned to the inbound Call Control application', () => {
  assert.equal(isInboundCallAnswered({ ...base, hasOutboundPair: false }), true);
});

test('accepts app-generated multi-call route identifiers only', () => {
  assert.equal(isVoiceRouteId('vc_m1a2b3c4_abc123def456_xy12z890'), true);
  assert.equal(isVoiceRouteId('short'), false);
  assert.equal(isVoiceRouteId('vc_invalid route identifier'), false);
});

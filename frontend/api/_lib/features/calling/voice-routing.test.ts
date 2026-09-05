import assert from 'node:assert/strict';
import test from 'node:test';
import { isVoiceRouteId } from './voice-route-id.js';
import { isInboundCallAnswered, isInboundCallInitiated, isParkedClientCall, ivrMenuSelection, resolveParkedReservation, voiceRouteHangupOutcome } from './voice-routing.js';

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

test('accepts the Telnyx outbound parking event emitted in production', () => {
  assert.equal(isParkedClientCall({
    connectionId: 'mobile-connection',
    credentialConnectionId: 'mobile-connection',
    direction: 'outgoing',
    flow: 'internal',
    flowDestination: 'ob_park',
    state: 'bridging',
  }), true);
});

test('keeps compatibility with parked events that use the parked state', () => {
  assert.equal(isParkedClientCall({
    connectionId: 'mobile-connection',
    credentialConnectionId: 'mobile-connection',
    direction: 'outgoing',
    flow: 'outbound',
    state: 'parked',
  }), true);
});

test('rejects ordinary outgoing calls and calls from another connection', () => {
  assert.equal(isParkedClientCall({
    connectionId: 'mobile-connection',
    credentialConnectionId: 'mobile-connection',
    direction: 'outgoing',
    flow: 'internal',
    state: 'bridging',
  }), false);
  assert.equal(isParkedClientCall({
    connectionId: 'other-connection',
    credentialConnectionId: 'mobile-connection',
    direction: 'outgoing',
    flow: 'internal',
    flowDestination: 'ob_park',
  }), false);
});

test('maps a disabled carrier account to a failed platform route', () => {
  assert.deepEqual(voiceRouteHangupOutcome({
    hangupCause: 'call_rejected',
    telnyxError: { error_code: 'D17' },
  }), { phase: 'failed', failureCause: 'platform_calling_unavailable' });
});

test('keeps ordinary local and remote clearing as a completed route', () => {
  assert.deepEqual(voiceRouteHangupOutcome({ hangupCause: 'normal_clearing' }), {
    phase: 'ended',
    failureCause: 'normal_clearing',
  });
});

test('treats a missing hangup cause as a failed route', () => {
  assert.deepEqual(voiceRouteHangupOutcome({}), { phase: 'failed', failureCause: 'call_failed' });
});

test('rejects a parked reservation after the caller canceled the route', () => {
  assert.equal(resolveParkedReservation({
    routeId: 'vc_route',
    signedReservation: { routeId: 'vc_route' },
    storedRoute: { routeId: 'vc_route', phase: 'ended' },
  }).reason, 'route_canceled');
});

test('does not map IVR timeouts or empty digits onto the first department', () => {
  assert.equal(ivrMenuSelection({}, 2), null);
  assert.equal(ivrMenuSelection({ status: 'timeout', digits: '' }, 2), null);
  assert.equal(ivrMenuSelection({ digits: '0' }, 2), null);
  assert.equal(ivrMenuSelection({ digits: '1' }, 2), 1);
});

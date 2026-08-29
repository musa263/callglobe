import assert from 'node:assert/strict';
import test from 'node:test';
import { isAlreadyTerminatedHangupError, isRetryableHangupError, outboundCallControlIds, outboundPlaybackCallControlIds } from './outbound-cancel.js';
import { mergeOutboundCallPair } from './outbound-call-store.js';
import { TelnyxApiError } from './telnyx.js';

test('returns every unique call leg in a merged outbound pair', () => {
  assert.deepEqual(outboundCallControlIds({
    clientCallControlId: 'client-a',
    destinationCallControlId: 'destination-a',
    forkDestinationCallControlIds: ['destination-a', 'destination-c'],
    peerClientCallControlId: 'client-b',
    peerDestinationCallControlId: 'destination-b',
    destination: '+15550000000',
    status: 'conference',
    updatedAt: new Date(0).toISOString(),
  }), ['client-a', 'destination-a', 'destination-c', 'client-b', 'destination-b']);
});

test('does not send duplicate hangup commands for the same call leg', () => {
  assert.deepEqual(outboundCallControlIds({
    clientCallControlId: 'client-a',
    destinationCallControlId: 'destination-a',
    peerClientCallControlId: 'client-a',
    destination: '+15550000000',
    status: 'direct',
    updatedAt: new Date(0).toISOString(),
  }), ['client-a', 'destination-a']);
});

test('stops ringback only on answered client legs', () => {
  assert.deepEqual(outboundPlaybackCallControlIds({
    clientCallControlId: 'client-a',
    destinationCallControlId: 'destination-a',
    peerClientCallControlId: 'client-b',
    peerDestinationCallControlId: 'destination-b',
    destination: '+15550000000',
    status: 'conference',
    updatedAt: new Date(0).toISOString(),
  }), ['client-a', 'client-b']);
});

test('does not let a stale webhook replace the claimed answer or terminal state', () => {
  const current = {
    clientCallControlId: 'client-a',
    destinationCallControlId: 'destination-a',
    forkDestinationCallControlIds: ['destination-a', 'destination-b'],
    selectedDestinationCallControlId: 'destination-a',
    destination: 'sip:user@sip.telnyx.com',
    status: 'direct' as const,
    phase: 'ended' as const,
    termination: {
      'destination-b': { status: 'terminated' as const, attempts: 1, updatedAt: new Date(1).toISOString() },
    },
    version: 4,
    updatedAt: new Date(1).toISOString(),
  };
  const merged = mergeOutboundCallPair(current, {
    ...current,
    phase: 'ringing',
    selectedDestinationCallControlId: 'destination-b',
    termination: {
      'destination-b': { status: 'pending', attempts: 0, updatedAt: new Date(0).toISOString() },
    },
    updatedAt: new Date(2).toISOString(),
  });
  assert.equal(merged.phase, 'ended');
  assert.equal(merged.selectedDestinationCallControlId, 'destination-a');
  assert.equal(merged.termination?.['destination-b']?.status, 'terminated');
  assert.equal(merged.version, 5);
});

test('retries only transient or conflicting Telnyx hangup failures', () => {
  assert.equal(isRetryableHangupError(new TelnyxApiError(503, 'busy')), true);
  assert.equal(isRetryableHangupError(new TelnyxApiError(409, 'not ready')), true);
  assert.equal(isRetryableHangupError(new TelnyxApiError(400, 'invalid')), false);
});

test('treats Telnyx inactive-call responses as an idempotent successful hangup', () => {
  assert.equal(isAlreadyTerminatedHangupError(new TelnyxApiError(404, 'not found')), true);
  assert.equal(isAlreadyTerminatedHangupError(new TelnyxApiError(422, "This call is no longer active and can't receive commands.")), true);
  assert.equal(isAlreadyTerminatedHangupError(new TelnyxApiError(422, 'Invalid call state transition.')), false);
});

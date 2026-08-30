import assert from 'node:assert/strict';
import test from 'node:test';
import { conferenceParticipantTeardown, isAlreadyTerminatedHangupError, isRetryableHangupError, outboundCallControlIds, shouldClaimTermination } from './outbound-cancel.js';
import { mergeOutboundCallPair } from './outbound-call-store.js';
import { TelnyxApiError } from './telnyx.js';

test('conference participant teardown never hangs the surviving remote', () => {
  const host = {
    clientCallControlId: 'client-a',
    destinationCallControlId: 'destination-a',
    selectedDestinationCallControlId: 'destination-a',
    peerClientCallControlId: 'client-b',
    peerDestinationCallControlId: 'destination-b',
    destination: '+15550000000',
    status: 'conference' as const,
    conferenceRole: 'host' as const,
    updatedAt: new Date(0).toISOString(),
  };
  const removedRemote = conferenceParticipantTeardown(host, 'destination-b');
  assert.deepEqual(removedRemote.hangIds, ['destination-b']);
  assert.equal(removedRemote.keepPair?.destinationCallControlId, 'destination-a');
  assert.equal(removedRemote.keepPair?.peerDestinationCallControlId, undefined);
  assert.equal(removedRemote.peerAction, 'clear');

  const removedHostRemote = conferenceParticipantTeardown(host, 'destination-a');
  assert.deepEqual(removedHostRemote.hangIds, ['destination-a']);
  assert.equal(removedHostRemote.keepPair?.destinationCallControlId, 'destination-b');
  assert.equal(removedHostRemote.peerAction, 'clear');
  const clobbered = mergeOutboundCallPair(host, removedHostRemote.keepPair!);
  assert.equal(clobbered.selectedDestinationCallControlId, 'destination-a');
  const applied = { ...removedHostRemote.keepPair! };
  assert.equal(applied.selectedDestinationCallControlId, 'destination-b');
  assert.deepEqual(applied.forkDestinationCallControlIds, []);
});

test('merging teardown hangs only the failed pair and unlinks the peer', () => {
  const merging = {
    clientCallControlId: 'client-a',
    destinationCallControlId: 'destination-a',
    selectedDestinationCallControlId: 'destination-a',
    peerClientCallControlId: 'client-b',
    peerDestinationCallControlId: 'destination-b',
    destination: '+15550000000',
    status: 'merging' as const,
    updatedAt: new Date(0).toISOString(),
  };
  const plan = conferenceParticipantTeardown(merging, 'destination-a');
  assert.deepEqual(plan.hangIds.sort(), ['client-a', 'destination-a']);
  assert.equal(plan.keepPair, null);
  assert.equal(plan.peerAction, 'unlink');
  assert.ok(!plan.hangIds.includes('destination-b'));
  assert.ok(!plan.hangIds.includes('client-b'));
});

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

test('single-flight termination skips fresh work and recovers abandoned claims', () => {
  const now = Date.now();
  assert.equal(shouldClaimTermination(undefined, now), true);
  assert.equal(shouldClaimTermination({ status: 'pending', attempts: 1, updatedAt: new Date(now - 1_000).toISOString() }, now), false);
  assert.equal(shouldClaimTermination({ status: 'pending', attempts: 1, updatedAt: new Date(now - 16_000).toISOString() }, now), true);
  assert.equal(shouldClaimTermination({ status: 'terminated', attempts: 1, updatedAt: new Date(now).toISOString() }, now), false);
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { liveOutboundDestinationId, mergeOutboundCallPair, type OutboundCallPair } from './outbound-call-store.js';

function pair(overrides: Partial<OutboundCallPair> = {}): OutboundCallPair {
  return {
    clientCallControlId: 'client',
    destinationCallControlId: 'first-fork',
    forkDestinationCallControlIds: ['first-fork', 'winner'],
    destination: '+15551212',
    status: 'direct',
    phase: 'ringing',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test('live destination prefers the answered fork', () => {
  assert.equal(liveOutboundDestinationId(pair()), 'first-fork');
  assert.equal(liveOutboundDestinationId(pair({ selectedDestinationCallControlId: 'winner' })), 'winner');
  assert.equal(liveOutboundDestinationId(pair({ destinationCallControlId: '', selectedDestinationCallControlId: undefined })), '');
});

test('pair merges keep the winning destination after a stale fork write', () => {
  const current = pair({
    phase: 'connected',
    selectedDestinationCallControlId: 'winner',
    destinationCallControlId: 'winner',
  });
  const merged = mergeOutboundCallPair(current, pair({
    phase: 'ringing',
    destinationCallControlId: 'first-fork',
    updatedAt: new Date().toISOString(),
  }));
  assert.equal(merged.selectedDestinationCallControlId, 'winner');
  assert.equal(merged.destinationCallControlId, 'winner');
  assert.equal(merged.phase, 'connected');
});

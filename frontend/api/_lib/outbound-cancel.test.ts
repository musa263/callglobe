import assert from 'node:assert/strict';
import test from 'node:test';
import { outboundCallControlIds } from './outbound-cancel.js';

test('returns every unique call leg in a merged outbound pair', () => {
  assert.deepEqual(outboundCallControlIds({
    clientCallControlId: 'client-a',
    destinationCallControlId: 'destination-a',
    peerClientCallControlId: 'client-b',
    peerDestinationCallControlId: 'destination-b',
    destination: '+15550000000',
    status: 'conference',
    updatedAt: new Date(0).toISOString(),
  }), ['client-a', 'destination-a', 'client-b', 'destination-b']);
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

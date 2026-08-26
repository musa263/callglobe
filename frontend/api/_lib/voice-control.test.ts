import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeVoiceState, encodeVoiceState } from './voice-control.js';

test('preserves the destination while ringback stops before an outbound bridge', () => {
  const encoded = encodeVoiceState({
    flow: 'outbound_bridge_pending',
    parentCallControlId: 'client-leg',
    destinationCallControlId: 'destination-leg',
    organizationId: 'company-a',
    routeId: 'vc_route',
  });
  assert.deepEqual(decodeVoiceState(encoded), {
    flow: 'outbound_bridge_pending',
    parentCallControlId: 'client-leg',
    destinationCallControlId: 'destination-leg',
    organizationId: 'company-a',
    routeId: 'vc_route',
  });
});

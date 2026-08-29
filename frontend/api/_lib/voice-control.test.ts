import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeVoiceState, dialCallBody, dialCallLegs, encodeVoiceState } from './voice-control.js';

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

test('normalizes single and forked Telnyx Dial response legs', () => {
  assert.deepEqual(dialCallLegs({ data: { call_control_id: 'one' } }), [{ call_control_id: 'one' }]);
  assert.deepEqual(dialCallLegs({ data: [
    { call_control_id: 'one' },
    { call_control_id: 'two' },
    {},
  ] }), [
    { call_control_id: 'one' },
    { call_control_id: 'two' },
  ]);
  assert.deepEqual(dialCallLegs({}), []);
});

test('uses Telnyx atomic bridge-on-answer settings for linked extension calls', () => {
  process.env.TELNYX_CALL_CONTROL_APP_ID = 'call-control-app';
  const body = dialCallBody({
    to: ['sip:device-a@sip.telnyx.com', 'sip:device-b@sip.telnyx.com'],
    from: '+18447161777',
    state: { flow: 'outbound_destination', bridgeOnAnswer: true },
    linkTo: 'parked-client-leg',
  });
  assert.equal(body.from, '+18447161777');
  assert.equal(body.link_to, 'parked-client-leg');
  assert.equal(body.bridge_intent, true);
  assert.equal(body.bridge_on_answer, true);
  assert.equal(body.prevent_double_bridge, true);
});

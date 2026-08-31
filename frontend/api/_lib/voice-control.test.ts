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

test('keeps PSTN destination Dial separate from its acknowledged bridge transaction', () => {
  process.env.TELNYX_CALL_CONTROL_APP_ID = 'call-control-app';
  const body = dialCallBody({
    to: ['+15551234567'],
    from: '+18447161777',
    state: { flow: 'outbound_destination', bridgeOnAnswer: false },
  });
  assert.equal(body.from, '+18447161777');
  assert.equal('link_to' in body, false);
  assert.equal('bridge_intent' in body, false);
  assert.equal('bridge_on_answer' in body, false);
});

test('internal destination Dial links to the parked caller for Telnyx native bridge', () => {
  process.env.TELNYX_CALL_CONTROL_APP_ID = 'call-control-app';
  const body = dialCallBody({
    to: ['sip:device-a@sip.telnyx.com', 'sip:device-b@sip.telnyx.com'],
    from: '+18447161777',
    linkTo: 'parked-caller',
    state: { flow: 'outbound_destination', bridgeOnAnswer: true },
  });
  assert.equal(body.link_to, 'parked-caller');
  assert.equal(body.bridge_intent, true);
  assert.equal(body.bridge_on_answer, true);
  assert.equal(body.prevent_double_bridge, true);
});

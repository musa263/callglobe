import assert from 'node:assert/strict';
import test from 'node:test';
import { parkedDestinationDialInput, parkedFlowUsesNativeBridge } from './parked-destination-dial.js';

test('only internal parked calls use Telnyx native bridge-on-answer', () => {
  assert.equal(parkedFlowUsesNativeBridge('internal'), true);
  assert.equal(parkedFlowUsesNativeBridge('outbound'), false);
});

test('PSTN parked Dial stays independent of the caller leg', () => {
  const dial = parkedDestinationDialInput({
    parkedCallControlId: 'parked',
    destination: '+15551234567',
    destinations: [],
    flow: 'outbound',
    from: '+18447161777',
    organizationId: 'org',
    routeId: 'vc_route',
  });
  assert.equal(dial.to, '+15551234567');
  assert.equal(dial.from, '+18447161777');
  assert.equal(dial.linkTo, undefined);
  assert.equal(dial.state.bridgeOnAnswer, false);
  assert.equal(dial.state.parentCallControlId, 'parked');
});

test('internal parked Dial forks SIP aliases and links them to the parked caller', () => {
  const dial = parkedDestinationDialInput({
    parkedCallControlId: 'parked',
    destination: 'sip:callee@sip.telnyx.com',
    destinations: ['sip:web@sip.telnyx.com', 'sip:mobile@sip.telnyx.com'],
    flow: 'internal',
    from: '+18447161777',
    organizationId: 'org',
    routeId: 'vc_route',
    sourceExtensionId: 'src',
    sourceExtension: '2000',
    sourceName: 'Musa',
    destinationExtensionId: 'dst',
    destinationExtension: '2003',
    destinationName: 'Alex',
  });
  assert.deepEqual(dial.to, ['sip:web@sip.telnyx.com', 'sip:mobile@sip.telnyx.com']);
  assert.equal(dial.from, '+18447161777');
  assert.equal(dial.linkTo, 'parked');
  assert.equal(dial.state.bridgeOnAnswer, true);
  assert.equal(dial.state.sourceExtension, '2000');
  assert.equal(dial.state.destinationExtension, '2003');
});

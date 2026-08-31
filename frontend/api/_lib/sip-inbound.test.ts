import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPbxConfig } from './pbx-config-store.js';
import { lookupSipInbound } from './sip-inbound.js';

test('keeps Telnyx-owned inbound DID lookup on Call Control until the SIP inbound flag is set', async () => {
  delete process.env.VOCIVO_SIP_INBOUND;
  const config = defaultPbxConfig();
  config.numberAssignments['+15551212'] = { organizationId: 'primary', source: 'owned', destinationType: 'main' };
  const lookup = await lookupSipInbound('+15551212', config);
  assert.equal(lookup.enabled, false);
  assert.equal(lookup.reason, 'call_control');
  assert.equal(lookup.bridge, '');
  assert.equal(lookup.wallet?.charged, false);
});

test('IVR destinations stay on Call Control after SIP inbound is enabled', async () => {
  const previous = process.env.VOCIVO_SIP_INBOUND;
  process.env.VOCIVO_SIP_INBOUND = '1';
  try {
    const config = defaultPbxConfig();
    config.numberAssignments['+15551212'] = { organizationId: 'primary', destinationType: 'ivr' };
    const lookup = await lookupSipInbound('+15551212', config);
    assert.equal(lookup.enabled, false);
    assert.equal(lookup.reason, 'call_control_features');
  } finally {
    if (previous === undefined) delete process.env.VOCIVO_SIP_INBOUND;
    else process.env.VOCIVO_SIP_INBOUND = previous;
  }
});

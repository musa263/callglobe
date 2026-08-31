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

test('owned IVR stays on Call Control when the SIP inbound flag is off', async () => {
  delete process.env.VOCIVO_SIP_INBOUND;
  const config = defaultPbxConfig();
  config.numberAssignments['+15551212'] = { organizationId: 'primary', source: 'owned', destinationType: 'ivr', destinationId: 'menu' };
  const lookup = await lookupSipInbound('+15551212', config);
  assert.equal(lookup.enabled, false);
  assert.equal(lookup.reason, 'call_control_features');
});

test('SIP inbound flag moves owned IVR onto the Vocivo edge', async () => {
  const previous = process.env.VOCIVO_SIP_INBOUND;
  process.env.VOCIVO_SIP_INBOUND = '1';
  try {
    const config = defaultPbxConfig();
    config.callHandling.ivrs = [{
      id: 'menu',
      name: 'Main',
      extension: '8000',
      greeting: 'Welcome.',
      options: { '1': 'extension:user-1' },
    }];
    config.numberAssignments['+15551212'] = { organizationId: 'primary', source: 'owned', destinationType: 'ivr', destinationId: 'menu' };
    const lookup = await lookupSipInbound('+15551212', config);
    assert.equal(lookup.enabled, true);
    assert.equal(lookup.action, 'ivr');
    assert.equal(lookup.bridge, '');
    assert.equal(lookup.wallet.charged, false);
  } finally {
    if (previous === undefined) delete process.env.VOCIVO_SIP_INBOUND;
    else process.env.VOCIVO_SIP_INBOUND = previous;
  }
});

test('bring-your-own SIP numbers run Vocivo IVR without the inbound flag', async () => {
  delete process.env.VOCIVO_SIP_INBOUND;
  const config = defaultPbxConfig();
  config.callHandling.ivrs = [{
    id: 'menu',
    name: 'Main',
    extension: '8000',
    greeting: 'Welcome.',
    options: { '1': 'ring_group:sales' },
  }];
  config.numberAssignments['+15551212'] = { organizationId: 'primary', source: 'sip_trunk', destinationType: 'ivr', destinationId: 'menu' };
  const lookup = await lookupSipInbound('+15551212', config);
  assert.equal(lookup.enabled, true);
  assert.equal(lookup.action, 'ivr');
  assert.equal(lookup.digits, '1');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPbxConfig } from './pbx-config-store.js';
import { lookupSipInbound } from './sip-inbound.js';

test('keeps inbound DID lookup on Call Control until the SIP inbound flag is set', async () => {
  delete process.env.VOCIVO_SIP_INBOUND;
  const config = defaultPbxConfig();
  config.numberAssignments['+15551212'] = { organizationId: 'primary', destinationType: 'main' };
  const lookup = await lookupSipInbound('+15551212', config);
  assert.equal(lookup.enabled, false);
  assert.equal(lookup.reason, 'call_control');
  assert.equal(lookup.bridge, '');
});

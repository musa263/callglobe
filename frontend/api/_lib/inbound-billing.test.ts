import assert from 'node:assert/strict';
import test from 'node:test';
import { numberReceivesCalls, numberUsesSipInbound, sipInboundBlockedReason, voiceWalletCharge } from './inbound-billing.js';

test('incoming and internal calls never debit the tenant wallet', () => {
  assert.deepEqual(voiceWalletCharge('inbound'), { charged: false, reason: 'inbound_free' });
  assert.deepEqual(voiceWalletCharge('internal'), { charged: false, reason: 'internal_free' });
  assert.equal(voiceWalletCharge('outbound').charged, true);
});

test('bring-your-own SIP numbers receive inbound on the Vocivo SIP edge', () => {
  assert.equal(numberUsesSipInbound({ source: 'sip_trunk', destinationType: 'main' }), true);
  assert.equal(numberReceivesCalls({ source: 'sip_trunk', destinationType: 'main' }), true);
  assert.equal(numberUsesSipInbound({ source: 'owned', destinationType: 'main' }), false);
  assert.equal(sipInboundBlockedReason({ source: 'owned', destinationType: 'main' }), 'call_control');
  assert.equal(numberReceivesCalls({ source: 'verified' }), false);
});

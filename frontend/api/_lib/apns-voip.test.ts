import assert from 'node:assert/strict';
import test from 'node:test';
import { isVocivoSipPush, vocivoSipPushPayload, apnsConfigured } from './apns-voip.js';
import { otherWakeupDevices } from './sip-wakeup-store.js';

test('Vocivo SIP push payload is distinct from Telnyx PushKit data', () => {
  const payload = vocivoSipPushPayload({
    uuid: '11111111-1111-4111-8111-111111111111',
    callId: 'abc@sip.vocivo.app',
    from: '+15555550100',
    callerName: 'Reception',
    username: 'ext2001',
  });
  assert.equal(payload.vocivo, 'sip');
  assert.equal(isVocivoSipPush(payload), true);
  assert.equal(isVocivoSipPush({ metadata: { voice_sdk: 'telnyx' } }), false);
  assert.deepEqual(vocivoSipPushPayload({ uuid: payload.uuid, callId: payload.callId, cancelled: true }).cancelled, '1');
});

test('answer-cancel keeps the answering token and rings every other iOS device', () => {
  const others = otherWakeupDevices({
    sipCallId: 'call-1',
    uuid: 'uuid-1',
    username: 'ext2001',
    createdAt: new Date().toISOString(),
    devices: [
      { token: 'aaa', environment: 'production', platform: 'ios' },
      { token: 'bbb', environment: 'production', platform: 'ios' },
      { token: 'ccc', environment: 'production', platform: 'android' },
    ],
  }, 'aaa');
  assert.deepEqual(others.map((item) => item.token), ['bbb']);
});

test('APNs sending is skipped until the VoIP auth key is configured', () => {
  const previous = process.env.APNS_AUTH_KEY;
  delete process.env.APNS_AUTH_KEY;
  try {
    assert.equal(apnsConfigured(), false);
  } finally {
    if (previous === undefined) delete process.env.APNS_AUTH_KEY;
    else process.env.APNS_AUTH_KEY = previous;
  }
});

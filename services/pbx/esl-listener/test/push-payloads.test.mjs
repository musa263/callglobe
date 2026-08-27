import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIncomingCallEnvelope } from '../src/push-payloads.mjs';

const call = {
  callId: 'not-a-native-uuid',
  sessionId: 'session-1',
  organizationId: 'global-heritage',
  organizationName: 'Global Heritage',
  targetExtension: '2001',
  caller: { name: 'Mousa Usman', number: '+966535548337', extension: '2000', photoUrl: 'https://example.com/mousa.jpg' },
  video: false,
};

test('incoming call envelope is valid for APNs VoIP and FCM data delivery', () => {
  const envelope = buildIncomingCallEnvelope(call, { bundleId: 'app.vocivo.mobile' });
  assert.match(envelope.call.callUUID, /^[0-9a-f-]{36}$/);
  assert.equal(envelope.apns.headers['apns-push-type'], 'voip');
  assert.equal(envelope.apns.headers['apns-topic'], 'app.vocivo.mobile.voip');
  assert.equal(envelope.apns.headers['apns-expiration'], '0');
  assert.equal(envelope.apns.payload.callerName, 'Mousa Usman');
  assert.equal(envelope.fcm.message.android.priority, 'high');
  assert.equal(envelope.fcm.message.data.hasVideo, 'false');
  assert.equal(typeof envelope.fcm.message.data.extension, 'string');
  assert.ok(Buffer.byteLength(JSON.stringify(envelope.apns.payload)) < 4096);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apnsConfig,
  apnsHost,
  apnsTokenIsDead,
  fcmConfig,
  fcmMessage,
  fcmTokenIsDead,
  normalizePrivateKey,
  voipPayload,
  voipTopic,
} from './mobile-push.js';

const call = {
  callId: 'call-123',
  sipUsername: 'ext-alice',
  callerName: 'Ada Lovelace',
  callerNumber: '+15551230000',
  ttlSeconds: 45,
};

test('the VoIP payload always carries a callable identity so iOS can report a call', () => {
  const payload = voipPayload(call, Date.parse('2026-09-02T00:00:00.000Z'));
  assert.deepEqual(payload.vocivo, {
    callId: 'call-123',
    sipUsername: 'ext-alice',
    callerName: 'Ada Lovelace',
    callerNumber: '+15551230000',
    expiresAt: '2026-09-02T00:00:45.000Z',
  });
});

test('a nameless caller still yields a display name rather than an empty CallKit entry', () => {
  const payload = voipPayload({ ...call, callerName: undefined, callerNumber: undefined });
  assert.equal(payload.vocivo.callerName, 'Incoming call');
  assert.equal(payload.vocivo.callerNumber, '');
});

test('the FCM message is a high-priority data message with string values only', () => {
  const message = fcmMessage('token-abc', call, Date.parse('2026-09-02T00:00:00.000Z'));
  assert.equal(message.message.token, 'token-abc');
  assert.equal(message.message.android.priority, 'HIGH');
  assert.equal(message.message.android.ttl, '45s');
  assert.equal(message.message.android.direct_boot_ok, true);
  assert.equal((message.message as { notification?: unknown }).notification, undefined);
  Object.values(message.message.data).forEach((value) => assert.equal(typeof value, 'string'));
  assert.equal(message.message.data.type, 'vocivo.incoming_call');
  assert.equal(message.message.data.expiresAt, '2026-09-02T00:00:45.000Z');
});

test('PushKit listens on the .voip topic and the suffix is never doubled', () => {
  assert.equal(voipTopic('com.vocivo.app'), 'com.vocivo.app.voip');
  assert.equal(voipTopic('com.vocivo.app.voip'), 'com.vocivo.app.voip');
  assert.equal(voipTopic('  com.vocivo.app  '), 'com.vocivo.app.voip');
  assert.throws(() => voipTopic('   '), /APNs topic/);
});

test('sandbox and production tokens go to different Apple hosts', () => {
  assert.equal(apnsHost('sandbox'), 'https://api.sandbox.push.apple.com');
  assert.equal(apnsHost('production'), 'https://api.push.apple.com');
});

test('only Apple responses that mean the token is gone drop the device', () => {
  assert.equal(apnsTokenIsDead(410), true);
  assert.equal(apnsTokenIsDead(400, 'BadDeviceToken'), true);
  assert.equal(apnsTokenIsDead(400, 'DeviceTokenNotForTopic'), true);
  // Transient or configuration problems must keep the device registered.
  assert.equal(apnsTokenIsDead(400, 'TopicDisallowed'), false);
  assert.equal(apnsTokenIsDead(429), false);
  assert.equal(apnsTokenIsDead(500), false);
  assert.equal(apnsTokenIsDead(403, 'ExpiredProviderToken'), false);
});

test('only FCM responses that mean the token is gone drop the device', () => {
  assert.equal(fcmTokenIsDead(404), true);
  assert.equal(fcmTokenIsDead(400, { error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'UNREGISTERED' }] } }), true);
  assert.equal(fcmTokenIsDead(403, { error: { status: 'UNREGISTERED' } }), true);
  assert.equal(fcmTokenIsDead(400, { error: { status: 'INVALID_ARGUMENT', details: [] } }), false);
  assert.equal(fcmTokenIsDead(500), false);
  assert.equal(fcmTokenIsDead(429), false);
});

test('escaped newlines in an env-supplied key are restored', () => {
  const key = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----';
  assert.equal(normalizePrivateKey(key), '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----');
  const already = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----';
  assert.equal(normalizePrivateKey(already), already);
});

test('APNs stays disabled until every credential is present', () => {
  assert.equal(apnsConfig({}), null);
  assert.equal(apnsConfig({ APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_AUTH_KEY: 'key' }), null);
  const config = apnsConfig({ APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_AUTH_KEY: 'a\\nb', APNS_TOPIC: 'com.vocivo.app' });
  assert.deepEqual(config, { keyId: 'K', teamId: 'T', privateKey: 'a\nb', topic: 'com.vocivo.app' });
});

test('FCM reads a service-account JSON blob or discrete variables', () => {
  assert.equal(fcmConfig({}), null);
  const json = JSON.stringify({ project_id: 'p', client_email: 'e@x', private_key: 'a\\nb' });
  assert.deepEqual(fcmConfig({ FCM_SERVICE_ACCOUNT: json }), { projectId: 'p', clientEmail: 'e@x', privateKey: 'a\nb' });
  // A malformed blob must not mask discrete variables that are set correctly.
  assert.deepEqual(
    fcmConfig({ FCM_SERVICE_ACCOUNT: '{not json', FCM_PROJECT_ID: 'p2', FCM_CLIENT_EMAIL: 'e2@x', FCM_PRIVATE_KEY: 'k' }),
    { projectId: 'p2', clientEmail: 'e2@x', privateKey: 'k' },
  );
});

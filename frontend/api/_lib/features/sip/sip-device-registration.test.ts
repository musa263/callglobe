import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createSipAuthHandler } from './routes/voice-sip-auth.js';
import { digestExpectedResponse, digestHa1 } from './sip-digest.js';
import { issueSipNonce, sipCredentialSession, validSipDeviceId } from './sip-edge-auth.js';
import { mergeSipCredentials, removeSipCredential, type StoredSipCredential } from './sip-credential-store.js';

test('the actual REGISTER authorizer accepts four devices after renewal and rejects only the signed-out credential', async (t) => {
  for (const [name, value] of Object.entries({ AUTH_SECRET: 'local-qa-auth-secret-only', SIP_EDGE_SECRET: 'local-qa-edge-secret-only' })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  const username = 'employee-one', realm = 'sip.vocivo.app';
  const sessionId = sipCredentialSession({ sub: 'extension:one', iat: 100, exp: 200, organizationId: 'tenant-one', extensionId: 'one' });
  assert.notEqual(sessionId, sipCredentialSession({ sub: 'extension:one', iat: 101, exp: 201, organizationId: 'tenant-one', extensionId: 'one' }));
  let stored: StoredSipCredential[] = [];
  for (const deviceId of ['browser-one', 'browser-two', 'iphone-one', 'android-one']) {
    stored = mergeSipCredentials(stored, { username, realm, extensionId: 'one', organizationId: 'tenant-one', client: deviceId.startsWith('browser') ? 'web' : 'mobile', deviceId, sessionId, credentialId: `${deviceId}-v1`, ha1: digestHa1(username, realm, deviceId), expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  }
  const handler = createSipAuthHandler({ readSipCredentials: async () => stored, claimReplayKey: async () => true });
  async function register(password: string) {
    const challenge = { username, realm, method: 'REGISTER', uri: `sip:${realm}`, nonce: issueSipNonce(username), cnonce: password, nc: '00000001', qop: 'auth', response: '' };
    challenge.response = digestExpectedResponse(digestHa1(username, realm, password), challenge);
    let status = 0;
    const res = { setHeader() {}, status(code: number) { status = code; return res; }, json() { return res; } } as unknown as VercelResponse;
    await handler({ method: 'POST', headers: { authorization: 'Bearer local-qa-edge-secret-only' }, body: { ...challenge, fromUser: username, toUser: username, fromDomain: realm, toDomain: realm, requestUri: challenge.uri } } as VercelRequest, res);
    return status;
  }
  for (const password of ['browser-one', 'browser-two', 'iphone-one', 'android-one']) assert.equal(await register(password), 200);
  stored = mergeSipCredentials(stored, { ...stored[0], credentialId: 'browser-one-v2', ha1: digestHa1(username, realm, 'renewed') });
  stored = removeSipCredential(stored, { deviceId: 'browser-one', sessionId, credentialId: 'browser-one-v1' });
  assert.equal(await register('renewed'), 200);
  stored = removeSipCredential(stored, { deviceId: 'iphone-one', sessionId, credentialId: 'iphone-one-v1' });
  assert.equal(await register('iphone-one'), 403);
  for (const password of ['browser-two', 'android-one', 'renewed']) assert.equal(await register(password), 200);
});

test('calling device identifiers reject malformed and unbounded client input', () => {
  assert.equal(validSipDeviceId('61aaacb0-cdc9-4c10-9b79-7395d4498fa9'), true);
  for (const value of [undefined, '', 'mobile', '../tenant', ['repeat'], 'x'.repeat(129)]) assert.equal(validSipDeviceId(value), false);
});

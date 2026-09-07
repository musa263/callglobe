import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createSipCredentialsHandler } from './routes/voice-sip-credentials.js';
import { defaultPbxConfig } from '../organizations/pbx-config-store.js';
import type { StoredSipCredential } from './sip-credential-store.js';

// Exercise the real response and persistence boundary, with no external accounts.
test('SIP configuration expires with TURN, while its Digest credential survives a long call', async () => {
  const values = { AUTH_SECRET: 'test-auth', VOCIVO_VOICE_EDGE: 'sip', VOCIVO_TURN_URLS: 'turn:relay.example:3478', VOCIVO_TURN_SECRET: 'x'.repeat(64), VOCIVO_SIP_REALM: 'sip.example', VOCIVO_SIP_DOMAIN: 'sip.example', VOCIVO_SIP_WSS_URI: 'wss://sip.example/ws' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    const saved: StoredSipCredential[] = [];
    const handler = createSipCredentialsHandler({
      requireSession: async () => ({ sub: 'alice', extensionId: 'e1', organizationId: 'acme', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 }) as never,
      readPbxConfig: async () => ({ ...defaultPbxConfig(), organizations: [{ id: 'acme', status: 'active' }] }) as never,
      getExtension: async () => ({ id: 'e1', organizationId: 'acme', sipUsername: 'alice', status: 'active' }) as never,
      accessForSession: async () => ({ superadmin: false, features: { internalCalling: true } }) as never,
      saveSipCredential: async value => { saved.push(value); },
      revokeSipCredential: async () => undefined,
    });
    const send = async () => {
      let code = 0;
      let payload: any;
      const res = { setHeader() {}, status(value: number) { code = value; return this; }, json(value: unknown) { payload = value; return this; } } as unknown as VercelResponse;
      await handler({ method: 'POST', headers: {}, body: { deviceId: 'test-device-123456' } } as VercelRequest, res);
      return { code, payload };
    };
    const before = Date.now();
    const { code, payload } = await send();
    assert.equal(code, 200);
    const relayExpires = Number(payload.ice_servers[0].username.split(':')[0]) * 1000;
    assert.ok(Date.parse(payload.expiresAt) <= relayExpires, 'client cache cannot outlive its TURN grant');
    assert.ok(before + payload.expires_in * 1000 <= relayExpires);
    assert.ok(payload.expires_in > 300, 'normal client renewal remains practical');
    assert.ok(Date.parse(saved[0].expiresAt) > before + 86400_000, 'active calls retain a valid Digest credential');
    delete process.env.VOCIVO_TURN_SECRET;
    assert.equal((await send()).code, 500);
    assert.equal(saved.length, 1, 'bad relay configuration must not rotate away a working credential');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

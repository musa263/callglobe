import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createSipAuthHandler } from './routes/voice-sip-auth.js';
import { issueSipNonce } from './sip-edge-auth.js';
import { digestExpectedResponse, digestHa1 } from './sip-digest.js';

test('real REGISTER handler rejects cross-extension/realm requests and consumed Digest responses', async () => {
  const previous = { SIP_EDGE_SECRET: process.env.SIP_EDGE_SECRET, AUTH_SECRET: process.env.AUTH_SECRET };
  Object.assign(process.env, { SIP_EDGE_SECRET: 'test-edge', AUTH_SECRET: 'test-auth' });
  try {
    const ha1 = digestHa1('alice', 'sip.example', 'test-password');
    let reads = 0;
    let allowed = true;
    const ledger = new Set<string>();
    const handler = createSipAuthHandler({
      sipRegistrationAllowed: async () => allowed,
      readSipCredentials: async () => { reads++; return [{ username: 'alice', extensionId: 'alice-id', organizationId: 'tenant-a', realm: 'sip.example', ha1, expiresAt: new Date(Date.now() + 60_000).toISOString() }]; },
      claimReplayKey: async (key) => { if (ledger.has(key)) return false; ledger.add(key); return true; },
    });
    const challenge = { username: 'alice', realm: 'sip.example', nonce: issueSipNonce('alice'), uri: 'sip:sip.example', method: 'REGISTER', qop: 'auth', cnonce: 'device-random', nc: '00000001', response: '' };
    challenge.response = digestExpectedResponse(ha1, challenge);
    const body = { ...challenge, fromUser: 'alice', toUser: 'alice', fromDomain: 'sip.example', toDomain: 'sip.example', requestUri: challenge.uri };
    const send = async (input: typeof body & { authorization?: string; algorithm?: string }) => {
      let code = 0;
      let payload: any;
      const res = { setHeader() {}, status(value: number) { code = value; return this; }, json(value: unknown) { payload = value; return this; } } as unknown as VercelResponse;
      await handler({ method: 'POST', headers: { authorization: 'Bearer test-edge' }, body: input } as VercelRequest, res);
      return { code, payload };
    };
    for (const mismatch of [{ toUser: 'bob' }, { fromUser: 'bob' }, { toDomain: 'tenant-b.example' }, { requestUri: 'sip:other.example' }]) {
      assert.equal((await send({ ...body, ...mismatch })).code, 403);
    }
    assert.equal((await send({ ...body, algorithm: 'SHA-256' })).payload.reason, 'unsupported_digest_algorithm');
    assert.equal((await send({ ...body, authorization: 'Basic invalid' })).payload.reason, 'invalid_digest_header');
    assert.equal(reads, 0, 'Identity and malformed digest failures never read credential rows');
    assert.deepEqual(await send(body), { code: 200, payload: { ok: true, extensionId: 'alice-id', organizationId: 'tenant-a' } });
    assert.equal((await send(body)).payload.reason, 'replayed_digest');
    const next = { ...body, nc: '00000002' };
    next.response = digestExpectedResponse(ha1, next);
    allowed = false;
    assert.deepEqual(await send(next), { code: 403, payload: { ok: false, reason: 'calling_access_revoked' } });
    allowed = true;
    assert.equal((await send(next)).code, 200);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('only a verified expired Digest asks the edge for stale-nonce recovery', async () => {
  const previous = { SIP_EDGE_SECRET: process.env.SIP_EDGE_SECRET, AUTH_SECRET: process.env.AUTH_SECRET };
  Object.assign(process.env, { SIP_EDGE_SECRET: 'test-edge', AUTH_SECRET: 'test-auth' });
  try {
    const ha1 = digestHa1('alice', 'sip.example', 'test-password');
    let claims = 0;
    const handler = createSipAuthHandler({
      sipRegistrationAllowed: async () => true,
      readSipCredentials: async () => [{ username: 'alice', extensionId: 'alice-id', organizationId: 'tenant-a', realm: 'sip.example', ha1, expiresAt: new Date(Date.now() + 60_000).toISOString() }],
      claimReplayKey: async () => { claims++; return true; },
    });
    const challenge = { username: 'alice', realm: 'sip.example', nonce: issueSipNonce('alice', new Date(Date.now() - 360_000)), uri: 'sip:sip.example', method: 'REGISTER', qop: 'auth', cnonce: 'device-random', nc: '00000001', response: '' };
    challenge.response = digestExpectedResponse(ha1, challenge);
    const body = { ...challenge, fromUser: 'alice', toUser: 'alice', fromDomain: 'sip.example', toDomain: 'sip.example', requestUri: challenge.uri };
    const send = async (input: typeof body) => {
      let code = 0;
      let payload: any;
      const res = { setHeader() {}, status(value: number) { code = value; return this; }, json(value: unknown) { payload = value; return this; } } as unknown as VercelResponse;
      await handler({ method: 'POST', headers: { authorization: 'Bearer test-edge' }, body: input } as VercelRequest, res);
      return { code, payload };
    };
    assert.deepEqual(await send(body), { code: 403, payload: { ok: false, reason: 'stale_nonce', stale: true } });
    assert.equal((await send({ ...body, response: '0'.repeat(32) })).payload.reason, 'password_mismatch');
    assert.notEqual((await send({ ...body, nonce: `${body.nonce}x` })).payload.stale, true);
    assert.equal(claims, 0, 'expired or invalid authentication never spends replay state');
    const fresh = { ...body, nonce: issueSipNonce('alice') };
    fresh.response = digestExpectedResponse(ha1, fresh);
    assert.equal((await send(fresh)).code, 200);
    assert.equal(claims, 1);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

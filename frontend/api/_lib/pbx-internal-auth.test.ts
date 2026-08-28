import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, signPbxRequest, verifyPbxRequest } from './pbx-internal-auth.js';

const nonce = '123e4567-e89b-12d3-a456-426614174000';

test('PBX webhook canonicalization is independent of key insertion order', () => {
  assert.equal(
    canonicalJson({ organizationId: 'primary', nested: { z: 2, a: 1 }, extension: '2000' }),
    canonicalJson({ extension: '2000', nested: { a: 1, z: 2 }, organizationId: 'primary' }),
  );
});

test('PBX signatures bind timestamp, nonce, and canonical body', () => {
  const previous = process.env.VOCIVO_WEBHOOK_SECRET;
  process.env.VOCIVO_WEBHOOK_SECRET = 'test-webhook-secret-that-is-long-enough';
  try {
    assert.match(signPbxRequest('1787824800', nonce, canonicalJson({ extension: '2000' })), /^sha256=[0-9a-f]{64}$/);
  } finally {
    if (previous === undefined) delete process.env.VOCIVO_WEBHOOK_SECRET; else process.env.VOCIVO_WEBHOOK_SECRET = previous;
  }
});

test('accepts a signed PBX request once and rejects its replay', async () => {
  const previous = process.env.VOCIVO_WEBHOOK_SECRET;
  process.env.VOCIVO_WEBHOOK_SECRET = 'test-webhook-secret-that-is-long-enough';
  const body = { organizationId: 'primary', extension: '2000' };
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signPbxRequest(timestamp, nonce, canonicalJson(body));
  const request = { headers: { 'x-vocivo-timestamp': timestamp, 'x-vocivo-nonce': nonce, 'x-vocivo-signature': signature }, body } as never;
  const claimed = new Set<string>();
  const claim = async (key: string) => !claimed.has(key) && Boolean(claimed.add(key));
  try {
    await verifyPbxRequest(request, claim);
    await assert.rejects(() => verifyPbxRequest(request, claim), /Unauthorized/);
  } finally {
    if (previous === undefined) delete process.env.VOCIVO_WEBHOOK_SECRET; else process.env.VOCIVO_WEBHOOK_SECRET = previous;
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, signPbxRequest } from './pbx-internal-auth.js';

test('PBX webhook canonicalization is independent of key insertion order', () => {
  assert.equal(
    canonicalJson({ organizationId: 'primary', nested: { z: 2, a: 1 }, extension: '2000' }),
    canonicalJson({ extension: '2000', nested: { a: 1, z: 2 }, organizationId: 'primary' }),
  );
});

test('PBX webhook signing returns an HMAC SHA-256 signature', () => {
  const previous = process.env.VOCIVO_WEBHOOK_SECRET;
  process.env.VOCIVO_WEBHOOK_SECRET = 'test-webhook-secret-that-is-long-enough';
  try {
    assert.match(signPbxRequest('1787824800', canonicalJson({ extension: '2000' })), /^sha256=[0-9a-f]{64}$/);
  } finally {
    if (previous === undefined) delete process.env.VOCIVO_WEBHOOK_SECRET;
    else process.env.VOCIVO_WEBHOOK_SECRET = previous;
  }
});

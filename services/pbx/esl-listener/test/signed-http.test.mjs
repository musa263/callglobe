import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, signBody, signaturesMatch } from '../src/signed-http.mjs';

test('canonical JSON is stable across object key order', () => {
  const first = { extension: '2001', organizationId: 'global-heritage', nested: { z: true, a: 1 } };
  const second = { nested: { a: 1, z: true }, organizationId: 'global-heritage', extension: '2001' };
  assert.equal(canonicalJson(first), canonicalJson(second));
});

test('webhook signatures cover timestamp and canonical body', () => {
  const secret = 'a'.repeat(32);
  const body = canonicalJson({ organizationId: 'primary', extension: '2000' });
  const nonce = '123e4567-e89b-12d3-a456-426614174000';
  const signature = signBody(secret, '1787824800', nonce, body);
  assert.equal(signaturesMatch(secret, '1787824800', nonce, body, signature), true);
  assert.equal(signaturesMatch(secret, '1787824801', nonce, body, signature), false);
  assert.equal(signaturesMatch(secret, '1787824800', '223e4567-e89b-12d3-a456-426614174000', body, signature), false);
});

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
  const signature = signBody(secret, '1787824800', body);
  assert.equal(signaturesMatch(secret, '1787824800', body, signature), true);
  assert.equal(signaturesMatch(secret, '1787824801', body, signature), false);
});

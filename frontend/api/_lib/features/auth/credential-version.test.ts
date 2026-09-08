import assert from 'node:assert/strict';
import test from 'node:test';
import { credentialVersion, assertCredentialVersion } from './credential-version.js';

test('password generations reject old sessions even when reset and issuance share a second', () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'test-only-session-key';
  try {
    const old = credentialVersion('old-bcrypt-hash');
    assert.doesNotThrow(() => assertCredentialVersion(old, 'old-bcrypt-hash'));
    assert.throws(() => assertCredentialVersion(old, 'new-bcrypt-hash'), /Unauthorized/);
    assert.throws(() => assertCredentialVersion(undefined, 'new-bcrypt-hash'), /Unauthorized/);
    assert.doesNotThrow(() => assertCredentialVersion(credentialVersion('new-bcrypt-hash'), 'new-bcrypt-hash'));
  } finally { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; }
});

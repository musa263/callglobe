import assert from 'node:assert/strict';
import test from 'node:test';
import { telnyxTokenLifetime } from './telnyx-token-lifetime.js';

test('uses the actual JWT deadline without extending short or expired grants', () => {
  const now = 1_800_000_000_000;
  const jwt = (claims: unknown) => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  for (const remaining of [86400, 3600, 15, 1]) {
    assert.equal(telnyxTokenLifetime(jwt({ exp: now / 1000 + remaining }), now), remaining);
  }
  for (const token of ['invalid', jwt({}), jwt({ exp: 'future' }), jwt({ exp: now / 1000 }), jwt({ exp: now / 1000 - 1 })]) {
    assert.throws(() => telnyxTokenLifetime(token, now), /invalid or expired/);
  }
});

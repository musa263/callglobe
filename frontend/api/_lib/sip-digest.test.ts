import assert from 'node:assert/strict';
import test from 'node:test';
import { digestExpectedResponse, digestHa1, digestMatches, parseDigestAuthorization } from './sip-digest.js';

test('verifies SIP Digest against a stored HA1 without recovering the password', () => {
  const username = 'ext-2000';
  const realm = 'sip.vocivo.local';
  const password = 'one-time-password';
  const ha1 = digestHa1(username, realm, password);
  const challenge = {
    username,
    realm,
    nonce: 'abc123',
    uri: 'sip:sip.vocivo.local',
    method: 'REGISTER',
    qop: 'auth',
    nc: '00000001',
    cnonce: 'xyz',
    response: '',
  };
  challenge.response = digestExpectedResponse(ha1, challenge);
  assert.equal(digestMatches(ha1, challenge), true);
  assert.equal(digestMatches(ha1, { ...challenge, response: 'deadbeef' }), false);
});

test('parses comma-separated Digest Authorization headers from SIP.js', () => {
  const parsed = parseDigestAuthorization(
    'Digest username="ext-2000", realm="sip.vocivo.app", nonce="abc123", uri="sip:sip.vocivo.app", response="deadbeef", algorithm=MD5, qop=auth, nc=00000001, cnonce="xyz"',
    'REGISTER',
  );
  assert.equal(parsed?.username, 'ext-2000');
  assert.equal(parsed?.realm, 'sip.vocivo.app');
  assert.equal(parsed?.qop, 'auth');
  assert.equal(parsed?.nc, '00000001');
  assert.equal(parsed?.cnonce, 'xyz');
});

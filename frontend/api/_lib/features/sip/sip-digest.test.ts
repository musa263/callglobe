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

test('rejects unsupported algorithms, auth-int and malformed qop fields', () => {
  const ha1 = digestHa1('alice', 'sip.example', 'secret');
  const challenge = { username: 'alice', realm: 'sip.example', nonce: 'nonce', uri: 'sip:sip.example', method: 'REGISTER', qop: 'auth', nc: '00000001', cnonce: 'random', response: '' };
  challenge.response = digestExpectedResponse(ha1, challenge);
  for (const algorithm of ['SHA-256', 'MD5-sess', 'unknown']) assert.equal(digestMatches(ha1, { ...challenge, algorithm }), false);
  for (const override of [{ qop: 'auth-int' }, { nc: '0' }, { nc: '00000000' }, { cnonce: '' }]) assert.equal(digestMatches(ha1, { ...challenge, ...override }), false);
  assert.equal(digestMatches(ha1, { ...challenge, response: challenge.response.toUpperCase() }), true);
});

test('rejects a different authentication scheme and duplicate digest fields', () => {
  const fields = 'username="alice", realm="sip.example", nonce="nonce", uri="sip:sip.example", response="1234"';
  assert.equal(parseDigestAuthorization(`Basic ${fields}`), null);
  assert.equal(parseDigestAuthorization(`Digest ${fields}, username="bob"`), null);
  assert.equal(parseDigestAuthorization(`Digest ${fields}, garbage`), null);
  assert.equal(parseDigestAuthorization(`Digest ${fields},`), null);
  assert.equal(parseDigestAuthorization(`Digest prefix ${fields}`), null);
});

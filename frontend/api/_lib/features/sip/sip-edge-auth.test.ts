import assert from 'node:assert/strict';
import test from 'node:test';
import { issueSipNonce, sipEdgeAuthorized, sipNonceIsValid } from './sip-edge-auth.js';

function request(headers: Record<string, string>) {
  return { headers } as never;
}

function withSecret<T>(secret: string | undefined, run: () => T) {
  const previous = process.env.SIP_EDGE_SECRET;
  if (secret === undefined) delete process.env.SIP_EDGE_SECRET; else process.env.SIP_EDGE_SECRET = secret;
  try { return run(); } finally {
    if (previous === undefined) delete process.env.SIP_EDGE_SECRET; else process.env.SIP_EDGE_SECRET = previous;
  }
}

test('accepts the edge secret as Bearer, as the legacy header, and as an HTTP Basic password', () => {
  withSecret('s3cret-edge', () => {
    assert.equal(sipEdgeAuthorized(request({ authorization: 'Bearer s3cret-edge' })), true);
    assert.equal(sipEdgeAuthorized(request({ 'x-vocivo-sip-edge': 's3cret-edge' })), true);
    assert.equal(sipEdgeAuthorized(request({ authorization: `Basic ${Buffer.from('vocivo:s3cret-edge').toString('base64')}` })), true, 'mod_xml_curl gateway-credentials');
    assert.equal(sipEdgeAuthorized(request({ authorization: `Basic ${Buffer.from('anyone:s3cret-edge').toString('base64')}` })), true, 'the username is not part of the secret');
  });
});

test('rejects wrong, empty, malformed, and username-only credentials', () => {
  withSecret('s3cret-edge', () => {
    assert.equal(sipEdgeAuthorized(request({ authorization: 'Bearer nope' })), false);
    assert.equal(sipEdgeAuthorized(request({ authorization: 'Bearer ' })), false);
    assert.equal(sipEdgeAuthorized(request({})), false);
    assert.equal(sipEdgeAuthorized(request({ authorization: `Basic ${Buffer.from('s3cret-edge').toString('base64')}` })), false, 'no colon means no password');
    assert.equal(sipEdgeAuthorized(request({ authorization: `Basic ${Buffer.from('vocivo:s3cret-edg').toString('base64')}` })), false);
    assert.equal(sipEdgeAuthorized(request({ authorization: 'Basic not-base64!!' })), false);
    assert.equal(sipEdgeAuthorized(request({ 'x-vocivo-sip-edge': '' })), false);
  });
});

test('a missing server secret fails closed', () => {
  withSecret(undefined, () => {
    assert.throws(() => sipEdgeAuthorized(request({ authorization: 'Bearer anything' })), /Missing server configuration/);
  });
});

test('a nonce the API issued is accepted for its user until it expires, and for nobody else', () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'auth-secret-for-tests';
  try {
    const issued = new Date('2026-09-03T12:00:00Z');
    const nonce = issueSipNonce('sam-1001', issued);
    assert.match(nonce, /^\d+\.[A-Za-z0-9_-]+$/);
    assert.equal(sipNonceIsValid(nonce, 'sam-1001', new Date('2026-09-03T12:04:00Z')), true);
    assert.equal(sipNonceIsValid(nonce, 'sam-1001', new Date('2026-09-03T12:06:00Z')), false, 'expired');
    assert.equal(sipNonceIsValid(nonce, 'eve-1002', issued), false, 'another user');
    assert.equal(sipNonceIsValid(`${nonce}x`, 'sam-1001', issued), false, 'tampered');
    // What Kamailio's own www_challenge produces when the nonce service is unreachable.
    assert.equal(sipNonceIsValid('aK1tNGEwM2E0YzRlN2Q5', 'sam-1001', issued), false);
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous;
  }
});

test('nonce expiry is exclusive at the deadline', () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'auth-secret-for-tests';
  try {
    const issued = new Date('2026-09-03T12:00:00Z');
    const nonce = issueSipNonce('alice', issued);
    assert.equal(sipNonceIsValid(nonce, 'alice', new Date('2026-09-03T12:04:59.999Z')), true);
    assert.equal(sipNonceIsValid(nonce, 'alice', new Date('2026-09-03T12:05:00Z')), false);
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous;
  }
});

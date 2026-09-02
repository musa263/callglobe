import assert from 'node:assert/strict';
import test from 'node:test';
import { sipEdgeAuthorized } from './sip-edge-auth.js';

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

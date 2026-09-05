import assert from 'node:assert/strict';
import test from 'node:test';
import { ownsSipRegistration, sipDigestReplayKey } from './sip-registration-auth.js';

const challenge = { username: 'tenantA-extension1', realm: 'sip.vocivo.app', method: 'REGISTER', uri: 'sip:sip.vocivo.app', nonce: 'signed', response: 'digest', qop: 'auth', cnonce: 'client', nc: '00000001' };
const identity = { fromUser: challenge.username, toUser: challenge.username, fromDomain: challenge.realm, toDomain: challenge.realm, requestUri: challenge.uri };

test('REGISTER binds both AOR users, domains and the actual request target', () => {
  assert.equal(ownsSipRegistration(challenge, identity), true);
  for (const patch of [
    { toUser: 'tenantA-extension2' }, { toUser: 'tenantB-extension1' },
    { fromUser: 'tenantB-extension1' }, { toUser: 'tenantA%2Dextension1' },
    { toDomain: 'other.example' }, { fromDomain: '' }, { requestUri: 'sip:evil.example' },
  ]) assert.equal(ownsSipRegistration(challenge, { ...identity, ...patch }), false);
});

test('Digest replay key requires qop auth and a positive nonce count', () => {
  assert.equal(sipDigestReplayKey(challenge), sipDigestReplayKey({ ...challenge, response: 'different' }));
  assert.notEqual(sipDigestReplayKey(challenge), sipDigestReplayKey({ ...challenge, nc: '00000002' }));
  for (const patch of [{ qop: undefined }, { qop: 'auth-int' }, { nc: '00000000' }, { cnonce: '' }]) {
    assert.equal(sipDigestReplayKey({ ...challenge, ...patch }), null);
  }
});

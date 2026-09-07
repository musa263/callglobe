import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { UserAgent } from 'sip.js';
import type { OutgoingRequestMessage } from 'sip.js/lib/core';
import { rotateSipPassword } from './sipCredentialRotation';

const config = { username: 'employee', password: 'old-password', domain: 'example.invalid', wsUri: 'wss://example.invalid/ws' };
const md5 = (text: string) => createHash('md5').update(text).digest('hex');
function agent() {
  return new UserAgent({
    uri: UserAgent.makeURI('sip:employee@example.invalid'),
    authorizationUsername: config.username, authorizationPassword: config.password,
    transportOptions: { server: config.wsUri }, logLevel: 'error',
  });
}

test('installed SIP.js authenticates new requests with a rotated password without replacing its core or transport', () => {
  const ua = agent();
  const core = ua.userAgentCore;
  const transport = ua.transport;
  const existingAuthentication = core.configuration.authenticationFactory();
  assert.equal(rotateSipPassword(ua, config, { ...config, password: 'new-password' }), true);
  const renewedAuthentication = core.configuration.authenticationFactory();
  const request = { method: 'REGISTER', ruri: UserAgent.makeURI('sip:example.invalid') } as OutgoingRequestMessage;
  for (const [authentication, password] of [[existingAuthentication, 'old-password'], [renewedAuthentication, 'new-password']] as const) {
    assert.ok(authentication);
    assert.equal(authentication.authenticate(request, { realm: config.domain, nonce: 'test-nonce', algorithm: 'MD5' }), true);
    const expected = md5(`${md5(`employee:example.invalid:${password}`)}:test-nonce:${md5('REGISTER:sip:example.invalid')}`);
    assert.ok(authentication.toString().includes(`response="${expected}"`));
  }
  assert.equal(ua.userAgentCore, core);
  assert.equal(ua.transport, transport);
  assert.equal(rotateSipPassword(ua, config, { ...config, password: 'new-password' }), false);
});

for (const changed of [{ username: 'another' }, { domain: 'another.invalid' }, { wsUri: 'wss://another.invalid/ws' }]) {
  test(`live password renewal refuses a different ${Object.keys(changed)[0]}`, () => {
    const ua = agent();
    assert.throws(() => rotateSipPassword(ua, config, { ...config, ...changed, password: 'new-password' }), /cannot change/);
    assert.equal(ua.configuration.authorizationPassword, config.password);
  });
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { UserAgent } from 'sip.js';
import type { OutgoingRequestMessage } from 'sip.js/lib/core';
import type { SessionDescriptionHandlerFactoryOptions } from 'sip.js/lib/platform/web';
import { rotateSipPassword, updateSipIceServers } from './sipCredentialRotation';

const config = { username: 'employee', password: 'old-password', domain: 'example.invalid', wsUri: 'wss://example.invalid/ws' };
const md5 = (text: string) => createHash('md5').update(text).digest('hex');
function agent() {
  return new UserAgent({
    uri: UserAgent.makeURI('sip:employee@example.invalid'),
    authorizationUsername: config.username, authorizationPassword: config.password,
    transportOptions: { server: config.wsUri }, logLevel: 'error',
  });
}

test('renewed ICE is applied to future dialogs without mutating existing handler configuration', () => {
  const ua = agent();
  const oldIce = [{ urls: 'turn:relay.invalid', username: 'old', credential: 'old-relay' }];
  const nextIce = [{ urls: 'turn:relay.invalid', username: 'new', credential: 'new-relay' }];
  ua.configuration.sessionDescriptionHandlerFactoryOptions = {
    iceGatheringTimeout: 3000, peerConnectionConfiguration: { iceServers: oldIce, bundlePolicy: 'max-bundle' },
  };
  const existingHandlerOptions = ua.configuration.sessionDescriptionHandlerFactoryOptions as SessionDescriptionHandlerFactoryOptions;
  updateSipIceServers(ua, nextIce);
  const renewed = ua.configuration.sessionDescriptionHandlerFactoryOptions as SessionDescriptionHandlerFactoryOptions;
  assert.deepEqual(existingHandlerOptions.peerConnectionConfiguration?.iceServers, oldIce);
  assert.deepEqual(renewed.peerConnectionConfiguration?.iceServers, nextIce);
  assert.equal(renewed.iceGatheringTimeout, 3000);
  assert.equal(renewed.peerConnectionConfiguration?.bundlePolicy, 'max-bundle');
});

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

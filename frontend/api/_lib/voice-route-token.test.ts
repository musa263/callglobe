import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceRouteToken, verifyVoiceRouteToken } from './voice-route-token.js';

const originalSecret = process.env.AUTH_SECRET;
process.env.AUTH_SECRET = 'test-route-secret';

test.after(() => {
  if (originalSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalSecret;
});

test('round trips a signed outbound authorization', () => {
  const token = createVoiceRouteToken({ routeId: 'vc_route', organizationId: 'primary', destination: '+2348000000000', callerId: '+18447161777', flow: 'outbound' });
  const authorization = verifyVoiceRouteToken(token);
  assert.equal(authorization?.routeId, 'vc_route');
  assert.equal(authorization?.organizationId, 'primary');
  assert.equal(authorization?.destination, '+2348000000000');
  assert.equal(authorization?.callerId, '+18447161777');
  assert.equal(authorization?.flow, 'outbound');
  const expectedExpiry = Math.floor(Date.now() / 1000) + 300;
  assert.ok(authorization && Math.abs((authorization.expiresAt || 0) - expectedExpiry) <= 1);
});

test('rejects tampered and expired authorizations', () => {
  const token = createVoiceRouteToken({ routeId: 'vc_route', organizationId: 'primary', destination: '+966500000000', flow: 'outbound' });
  assert.equal(verifyVoiceRouteToken(`${token.slice(0, -1)}x`), null);
  assert.equal(verifyVoiceRouteToken(createVoiceRouteToken({ routeId: 'vc_route', organizationId: 'primary', destination: '+966500000000', flow: 'outbound' }, -1)), null);
});

test('keeps an internal employee name and extension inside the signed route', () => {
  const token = createVoiceRouteToken({
    routeId: 'vc_internal', organizationId: 'primary', destination: 'sip:employee@sip.telnyx.com',
    callerName: 'Othman Uthman', callerExtension: '2001', sourceExtensionId: 'source-id',
    callerSipUsername: 'credential-source-user',
    callerPhotoUrl: 'https://vocivo.vercel.app/profile/othman.jpg',
    destinationName: 'Musa Usman', destinationExtension: '2000', destinationExtensionId: 'destination-id', flow: 'internal',
  });
  const authorization = verifyVoiceRouteToken(token);
  assert.equal(authorization?.callerName, 'Othman Uthman');
  assert.equal(authorization?.callerExtension, '2001');
  assert.equal(authorization?.sourceExtensionId, 'source-id');
  assert.equal(authorization?.callerSipUsername, 'credential-source-user');
  assert.equal(authorization?.callerPhotoUrl, 'https://vocivo.vercel.app/profile/othman.jpg');
  assert.equal(authorization?.destinationName, 'Musa Usman');
  assert.equal(authorization?.destinationExtension, '2000');
  assert.equal(authorization?.destinationExtensionId, 'destination-id');
  assert.equal(authorization?.flow, 'internal');
});

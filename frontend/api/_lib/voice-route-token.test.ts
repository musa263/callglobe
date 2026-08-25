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
  assert.deepEqual(verifyVoiceRouteToken(token), {
    routeId: 'vc_route', organizationId: 'primary', destination: '+2348000000000', callerId: '+18447161777', flow: 'outbound', expiresAt: Math.floor(Date.now() / 1000) + 300,
  });
});

test('rejects tampered and expired authorizations', () => {
  const token = createVoiceRouteToken({ routeId: 'vc_route', organizationId: 'primary', destination: '+966500000000', flow: 'outbound' });
  assert.equal(verifyVoiceRouteToken(`${token.slice(0, -1)}x`), null);
  assert.equal(verifyVoiceRouteToken(createVoiceRouteToken({ routeId: 'vc_route', organizationId: 'primary', destination: '+966500000000', flow: 'outbound' }, -1)), null);
});

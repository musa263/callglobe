import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionMayControlVoiceRoute } from './voice-route-control.js';
import type { ReservedVoiceRoute } from './voice-route-store.js';

const route: ReservedVoiceRoute = {
  routeId: 'vc_test',
  userId: 'vocivo-extension:caller',
  organizationId: 'primary',
  destination: 'sip:callee@sip.telnyx.com',
  destinationExtensionId: 'callee',
  flow: 'internal',
  phase: 'ringing',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

test('the caller who reserved the route can cancel or report progress', () => {
  assert.equal(sessionMayControlVoiceRoute({ sub: 'vocivo-extension:caller' }, route), true);
});

test('the destination extension in the same tenant can cancel or report progress', () => {
  assert.equal(sessionMayControlVoiceRoute({
    sub: 'vocivo-extension:callee',
    organizationId: 'primary',
    extensionId: 'callee',
  }, route), true);
});

test('another extension cannot control someone else’s route', () => {
  assert.equal(sessionMayControlVoiceRoute({
    sub: 'vocivo-extension:other',
    organizationId: 'primary',
    extensionId: 'other',
  }, route), false);
});

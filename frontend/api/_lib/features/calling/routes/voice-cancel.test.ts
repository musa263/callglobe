import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createVoiceCancelHandler } from './voice-cancel.js';
import type { ReservedVoiceRoute } from '../voice-route-store.js';
import type { OutboundCallPair } from '../outbound-call-store.js';

test('cancel API retains retryable legs and never acknowledges a failed remote hangup', async () => {
  const route = { routeId: 'route-under-test-123', organizationId: 'company-a', userId: 'user-a', wakeupCallControlIds: ['wake-1'] } as ReservedVoiceRoute;
  let complete = false, wakeComplete = true, writes = 0, allowed = true, confirmState = true;
  const pair = { status: 'direct' } as OutboundCallPair;
  const handler = createVoiceCancelHandler({
    requireSession: async () => ({ sub: 'user-a', organizationId: 'company-a' }),
    readVoiceRoute: async () => route,
    sessionMayControlVoiceRoute: () => allowed,
    readOutboundCallPairByRoute: async () => pair,
    terminateOutboundPair: async () => ({ complete, pair: { ...pair, version: 1 } }),
    hangupCallControlIds: async () => wakeComplete,
    updateVoiceRoute: async () => { writes += 1; return confirmState ? route : null; },
  });
  const request = async () => {
    let status = 200, body: any;
    const res = { setHeader() {}, status(value: number) { status = value; return res; }, json(value: unknown) { body = value; return res; } } as unknown as VercelResponse;
    await handler({ method: 'POST', body: { routeId: route.routeId } } as VercelRequest, res);
    return { status, body };
  };
  assert.deepEqual((await request()).body.canceled, false);
  assert.equal(writes, 0);
  complete = true; wakeComplete = false;
  assert.equal((await request()).status, 503);
  assert.equal(writes, 0);
  wakeComplete = true;
  assert.equal((await request()).body.canceled, true);
  assert.equal(writes, 1);
  allowed = false;
  assert.equal((await request()).status, 404);
  assert.equal(writes, 1, 'a different tenant may not mutate cancellation state');
  allowed = true; confirmState = false;
  assert.equal((await request()).body.canceled, false, 'an unconfirmed state write is not an acknowledged cancel');
});

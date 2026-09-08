import assert from 'node:assert/strict';
import test from 'node:test';
import { disposeTelnyxCall, voiceRetryDelay, TELNYX_ROUTE_SETUP_MS, TELNYX_ROUTE_POLL_MS } from './telnyxRecovery.ts';

test('socket loss stops RTP even when signaling hangup rejects', async () => {
  let stopped = 0, closed = 0;
  const errors: unknown[] = [];
  const track = { stop() { stopped++; } };
  disposeTelnyxCall({ peer: { instance: { getSenders: () => [{ track }], getReceivers: () => [], close() { closed++; } } },
    localStream: { getTracks: () => [track] }, hangup: async () => { throw new Error('offline'); } }, (_op, error) => errors.push(error));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, 1); assert.equal(closed, 1); assert.equal(errors.length, 1);
});

test('recovery backoff is bounded and polling covers carrier ringing without flooding', () => {
  assert.equal(voiceRetryDelay(0), 1000);
  assert.equal(voiceRetryDelay(100), 30000);
  assert.ok(TELNYX_ROUTE_SETUP_MS >= 45000);
  assert.ok(TELNYX_ROUTE_SETUP_MS / TELNYX_ROUTE_POLL_MS <= 60);
});

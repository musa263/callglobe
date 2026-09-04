import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createSipWakeupHandler } from './routes/voice-sip-wakeup.js';

test('SIP wakeup replies before directory and push I/O finish and preserves the call ID', async () => {
  const oldSecret = process.env.SIP_EDGE_SECRET;
  process.env.SIP_EDGE_SECRET = 'test-edge-secret';
  let release!: (rows: never[]) => void;
  const directory = new Promise<never[]>((resolve) => { release = resolve; });
  let background: Promise<unknown> | undefined;
  let mobileStarted = false;
  let status = 0;
  let body: unknown;
  const handler = createSipWakeupHandler({
    listExtensions: async () => directory,
    afterResponse: (_label, task) => { background = task; },
    sendIncomingCallWebPush: async () => ({ sent: 0, unavailable: false }),
    wakeMobileDevices: async () => {
      mobileStarted = true;
      return { attempted: 0, sent: 0, pruned: 0, unavailable: { ios: false, android: false }, failures: [] };
    },
  });
  const res = {
    setHeader() {},
    status(code: number) { status = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as VercelResponse;
  try {
    await handler({ method: 'POST', headers: { authorization: 'Bearer test-edge-secret' }, body: { username: 'ext-alice', callId: 'sip-call@edge' } } as VercelRequest, res);
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, uuid: 'sip-call@edge', queued: true });
    assert.equal(mobileStarted, false);
    assert.ok(background);
    release([]);
    await background;
    assert.equal(mobileStarted, true);
  } finally {
    release([]);
    if (oldSecret === undefined) delete process.env.SIP_EDGE_SECRET;
    else process.env.SIP_EDGE_SECRET = oldSecret;
  }
});

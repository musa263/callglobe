import assert from 'node:assert/strict';
import test from 'node:test';
import { bridgeOutboundCalls } from './outbound-bridge.js';
import { TelnyxApiError } from './telnyx.js';

test('retries a transient bridge race with a fresh command id', async () => {
  const commands: string[] = [];
  const waits: number[] = [];
  let attempts = 0;
  const action = async (_callId: string, _action: string, body: Record<string, unknown> = {}) => {
    commands.push(String(body.command_id));
    attempts += 1;
    if (attempts === 1) throw new TelnyxApiError(422, 'Call leg is not ready');
    return new Response('{}', { status: 200 });
  };

  await bridgeOutboundCalls('client', 'destination', 'event', action, async (milliseconds) => { waits.push(milliseconds); });

  assert.deepEqual(commands, ['event-bridge-1', 'event-bridge-2']);
  assert.deepEqual(waits, [250]);
});

test('does not retry a permanent bridge request error', async () => {
  let attempts = 0;
  const action = async () => {
    attempts += 1;
    throw new TelnyxApiError(400, 'Invalid call control ID');
  };

  await assert.rejects(() => bridgeOutboundCalls('client', 'destination', 'event', action, async () => undefined), /Invalid call control ID/);
  assert.equal(attempts, 1);
});

test('stops after three transient bridge failures', async () => {
  let attempts = 0;
  const action = async () => {
    attempts += 1;
    throw new TelnyxApiError(503, 'Temporarily unavailable');
  };

  await assert.rejects(() => bridgeOutboundCalls('client', 'destination', 'event', action, async () => undefined), /Temporarily unavailable/);
  assert.equal(attempts, 3);
});

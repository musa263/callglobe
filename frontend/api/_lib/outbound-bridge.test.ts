import assert from 'node:assert/strict';
import test from 'node:test';
import { answerParkedCallerThenBridge, bridgeOutboundCalls, prepareParkedCallerMedia } from './outbound-bridge.js';
import { TelnyxApiError } from './telnyx.js';

test('retries a transient bridge race with a fresh command id', async () => {
  const commands: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  const waits: number[] = [];
  let attempts = 0;
  const action = async (_callId: string, _action: string, body: Record<string, unknown> = {}) => {
    commands.push(String(body.command_id));
    bodies.push(body);
    attempts += 1;
    if (attempts === 1) throw new TelnyxApiError(422, 'Call leg is not ready');
    return new Response('{}', { status: 200 });
  };

  await bridgeOutboundCalls('client', 'destination', 'event', action, async (milliseconds) => { waits.push(milliseconds); });

  assert.deepEqual(commands, ['event-bridge-1', 'event-bridge-2']);
  assert.deepEqual(waits, [250]);
  assert.equal(bodies[1]?.park_after_unbridge, undefined);
  assert.equal(bodies[1]?.hold_after_unbridge, undefined);
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

test('treats an already-bridged destination as a successful bridge', async () => {
  const action = async (_callId: string, command: string) => {
    if (command === 'bridge') throw new TelnyxApiError(422, 'Call is already bridged');
    return new Response('{}', { status: 200 });
  };
  await bridgeOutboundCalls('client', 'destination', 'event', action, async () => undefined);
});

test('prepares parked media without issuing a second Vocivo bridge', async () => {
  const actions: string[] = [];
  const action = async (_callId: string, command: string) => {
    actions.push(command);
    return new Response('{}', { status: 200 });
  };
  await prepareParkedCallerMedia('client', 'event', action);
  assert.deepEqual(actions, ['answer', 'playback_stop']);
});

test('answers the parked caller only when the destination answers, then bridges', async () => {
  const actions: string[] = [];
  const action = async (_callId: string, command: string) => {
    actions.push(command);
    return new Response('{}', { status: 200 });
  };
  await answerParkedCallerThenBridge('client', 'destination', 'event', action, async () => undefined);
  assert.deepEqual(actions, ['answer', 'playback_stop', 'bridge']);
});

test('treats an already-answered parked caller as ready to bridge', async () => {
  const actions: string[] = [];
  const action = async (_callId: string, command: string) => {
    actions.push(command);
    if (command === 'answer') throw new TelnyxApiError(422, 'Call has already been answered');
    return new Response('{}', { status: 200 });
  };
  await answerParkedCallerThenBridge('client', 'destination', 'event', action, async () => undefined);
  assert.deepEqual(actions, ['answer', 'playback_stop', 'bridge']);
});

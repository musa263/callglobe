import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createVoiceWebhookHandler } from './voice-webhook.js';
import { encodeVoiceState } from '../voice-control.js';
import type { OutboundCallPair } from '../outbound-call-store.js';
import type { QueueCall } from '../queue-call-store.js';
import type { ReservedVoiceRoute } from '../voice-route-store.js';

for (const conference of [false, true]) {
  test(`hangup webhook retries incomplete ${conference ? 'conference' : 'direct'} cleanup`, async () => {
    const prior = { app: process.env.TELNYX_CALL_CONTROL_APP_ID, connection: process.env.TELNYX_CONNECTION_ID };
    process.env.TELNYX_CALL_CONTROL_APP_ID = 'app';
    process.env.TELNYX_CONNECTION_ID = 'credential';
    let complete = false, attempts = 0;
    const pair: OutboundCallPair = { clientCallControlId: 'client', destinationCallControlId: 'destination',
      destination: 'fixture', status: conference ? 'conference' : 'direct', conferenceRole: 'host',
      phase: 'connected', updatedAt: new Date().toISOString() };
    const handler = createVoiceWebhookHandler({
      verifyTelnyxWebhook: async () => true,
      storeCallEvent: async () => undefined,
      background: (_label, task) => { void task; },
      readOutboundCallPairByClient: async () => pair,
      readOutboundCallPairByDestination: async () => null,
      terminateOutboundPair: async () => { attempts++; return { complete, pair: { ...pair, version: 1 } }; },
      hangupConferenceParticipant: async () => { attempts++; return complete; },
    });
    const request = async () => {
      let status = 0;
      const res = { status(code: number) { status = code; return res; }, json() { return res; } } as unknown as VercelResponse;
      await handler({ method: 'POST', body: { data: { id: 'same-delivery', event_type: 'call.hangup', payload: {
        call_control_id: 'client', connection_id: 'credential',
        client_state: encodeVoiceState({ flow: 'api_outbound', organizationId: 'company-a' }),
      } } } } as VercelRequest, res);
      return status;
    };
    try {
      assert.equal(await request(), 500, 'incomplete carrier work must request redelivery');
      complete = true;
      assert.equal(await request(), 200);
      assert.equal(attempts, 2);
    } finally {
      for (const [name, value] of [['TELNYX_CALL_CONTROL_APP_ID', prior.app], ['TELNYX_CONNECTION_ID', prior.connection]]) {
        if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
      }
    }
  });
}

test('dequeue during a successful queue bridge ends only losers and retains the winner', async () => {
  const oldApp = process.env.TELNYX_CALL_CONTROL_APP_ID;
  const oldConnection = process.env.TELNYX_CONNECTION_ID;
  process.env.TELNYX_CALL_CONTROL_APP_ID = 'app'; process.env.TELNYX_CONNECTION_ID = 'credential';
  const ended: string[][] = []; let cleared = 0;
  const handler = createVoiceWebhookHandler({
    verifyTelnyxWebhook: async () => true, storeCallEvent: async () => undefined, background: (_label, task) => { void task; },
    readQueueCall: async () => ({ status: 'connected', bridgedAgentCallControlId: 'winner', agentCallControlIds: ['winner', 'loser'] } as QueueCall),
    requireHangup: async ids => { ended.push(ids); },
    clearQueueCall: async () => { cleared++; },
  });
  const res = { status() { return res; }, json() { return res; } } as unknown as VercelResponse;
  try {
    await handler({ method: 'POST', body: { data: { id: 'dequeue', event_type: 'call.dequeued', payload: {
      call_control_id: 'caller', client_state: encodeVoiceState({ flow: 'queue_wait', queueName: 'queue', organizationId: 'company-a' }),
    } } } } as VercelRequest, res);
    assert.deepEqual(ended, [['loser']]); assert.equal(cleared, 0);
  } finally {
    if (oldApp === undefined) delete process.env.TELNYX_CALL_CONTROL_APP_ID; else process.env.TELNYX_CALL_CONTROL_APP_ID = oldApp;
    if (oldConnection === undefined) delete process.env.TELNYX_CONNECTION_ID; else process.env.TELNYX_CONNECTION_ID = oldConnection;
  }
});

for (const flow of ['outbound_destination', 'agent'] as const) {
  test(`late ${flow} initiated preserves the answered winner but terminates canceled or losing legs`, async () => {
    const oldApp = process.env.TELNYX_CALL_CONTROL_APP_ID, oldConnection = process.env.TELNYX_CONNECTION_ID;
    process.env.TELNYX_CALL_CONTROL_APP_ID = 'app'; process.env.TELNYX_CONNECTION_ID = 'credential';
    let phase: 'connected' | 'ended' = 'connected';
    const ended: string[] = [];
    const readPair = async () => ({ clientCallControlId: 'caller', destinationCallControlId: 'winner', selectedDestinationCallControlId: 'winner',
      destination: 'fixture', status: 'direct' as const, phase, updatedAt: new Date().toISOString() });
    const handler = createVoiceWebhookHandler({
      verifyTelnyxWebhook: async () => true, storeCallEvent: async () => undefined, background: (_label, task) => { void task; },
      readVoiceRoute: async () => ({ phase } as ReservedVoiceRoute), readOutboundCallPairByRoute: readPair, readOutboundCallPairByClient: readPair,
      requireHangup: async ids => { ended.push(...ids); },
      terminateOutboundLegs: async (pair, ids) => { ended.push(...ids); return { ...pair, version: 1,
        termination: Object.fromEntries(ids.map(id => [id, { status: 'terminated' as const, attempts: 1, updatedAt: new Date().toISOString() }])) }; },
    });
    const request = async (id: string) => {
      let status = 0;
      const res = { status(code: number) { status = code; return res; }, json() { return res; } } as unknown as VercelResponse;
      await handler({ method: 'POST', body: { data: { id: 'late-event', event_type: 'call.initiated', payload: {
        call_control_id: id, client_state: encodeVoiceState({ flow, routeId: 'route', parentCallControlId: 'caller', organizationId: 'company-a' }),
      } } } } as VercelRequest, res);
      assert.equal(status, 200);
    };
    try {
      await request('winner'); assert.deepEqual(ended, []);
      await request('loser'); assert.deepEqual(ended, ['loser']);
      phase = 'ended'; await request('winner'); assert.deepEqual(ended, ['loser', 'winner']);
    } finally {
      if (oldApp === undefined) delete process.env.TELNYX_CALL_CONTROL_APP_ID; else process.env.TELNYX_CALL_CONTROL_APP_ID = oldApp;
      if (oldConnection === undefined) delete process.env.TELNYX_CONNECTION_ID; else process.env.TELNYX_CONNECTION_ID = oldConnection;
    }
  });
}

test('winner audio is bridged before loser cleanup and cleanup failure never tears down the winner', async () => {
  const oldApp = process.env.TELNYX_CALL_CONTROL_APP_ID, oldConnection = process.env.TELNYX_CONNECTION_ID;
  process.env.TELNYX_CALL_CONTROL_APP_ID = 'app'; process.env.TELNYX_CONNECTION_ID = 'credential';
  const operations: string[] = [];
  const pair: OutboundCallPair = { clientCallControlId: 'caller', destinationCallControlId: 'winner',
    selectedDestinationCallControlId: 'winner', destination: 'fixture', status: 'direct', phase: 'ringing', updatedAt: new Date().toISOString() };
  const handler = createVoiceWebhookHandler({
    verifyTelnyxWebhook: async () => true, storeCallEvent: async () => undefined, background: (_label, task) => { void task; },
    readOutboundCallPairByDestination: async () => pair,
    claimOutboundCallWinner: async () => ({ won: true, pair: { ...pair, version: 1 }, loserIds: ['loser'] }),
    prepareParkedCallerMedia: async () => undefined,
    answerParkedCallerThenBridge: async () => { operations.push('bridge'); },
    saveOutboundCallPair: async next => { operations.push(next.phase || ''); return { ...next, version: 1 }; },
    terminateOutboundLegs: async () => { operations.push('cleanup'); return { ...pair, version: 1 }; },
    terminateOutboundPair: async () => { operations.push('end-winner'); return { complete: true, pair: { ...pair, version: 1 } }; },
  });
  let status = 0;
  const res = { status(code: number) { status = code; return res; }, json() { return res; } } as unknown as VercelResponse;
  try {
    await handler({ method: 'POST', body: { data: { id: 'answered', event_type: 'call.answered', payload: {
      call_control_id: 'winner', client_state: encodeVoiceState({ flow: 'outbound_destination', parentCallControlId: 'caller', organizationId: 'company-a' }),
    } } } } as VercelRequest, res);
    assert.equal(status, 500);
    assert.deepEqual(operations, ['bridge', 'connected', 'cleanup']);
  } finally {
    if (oldApp === undefined) delete process.env.TELNYX_CALL_CONTROL_APP_ID; else process.env.TELNYX_CALL_CONTROL_APP_ID = oldApp;
    if (oldConnection === undefined) delete process.env.TELNYX_CONNECTION_ID; else process.env.TELNYX_CONNECTION_ID = oldConnection;
  }
});

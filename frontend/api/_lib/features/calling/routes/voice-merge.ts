import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { telnyx, TelnyxApiError } from '../../../shared/telnyx.js';
import { readOutboundCallPairByRoute, saveOutboundCallPair, liveOutboundDestinationId, updateOutboundCallPair, type OutboundCallPair } from '../outbound-call-store.js';
import { hangupConferenceParticipant } from '../outbound-cancel.js';
import { callAction } from '../voice-control.js';
import { isVoiceRouteId } from '../voice-route-id.js';
import { readVoiceRoute } from '../voice-route-store.js';
import { updateVoiceRoute } from '../voice-route-store.js';
import { bridgeOutboundCalls } from '../outbound-bridge.js';
import { readPbxConfig } from '../../organizations/pbx-config-store.js';
import { requireFeature } from '../../organizations/saas-access.js';

async function waitForPair(reader: (id: string) => Promise<OutboundCallPair | null>, id: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const pair = await reader(id);
    if (pair) return pair;
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return null;
}

function retryableConferenceError(error: unknown) {
  return error instanceof TelnyxApiError
    && ([404, 409, 422, 429].includes(error.status) || error.status >= 500)
    && error.code !== '90018';
}

async function withConferenceRetry<T>(operation: (attempt: number) => Promise<T>) {
  const delays = [0, 300, 700, 1_200];
  let lastError: unknown;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!retryableConferenceError(error) || attempt === delays.length - 1) throw error;
    }
  }
  throw lastError;
}

async function requireLiveCall(callControlId: string) {
  return withConferenceRetry(async () => {
    const response = await telnyx(`/calls/${encodeURIComponent(callControlId)}`);
    const payload = await response.json() as { data?: { is_alive?: boolean } };
    if (!payload.data?.is_alive) throw new TelnyxApiError(409, 'A call leg ended before the merge completed.', 'VOCIVO_CALL_ENDED');
  });
}

async function joinConference(conferenceId: string, callControlId: string, commandId: string) {
  await withConferenceRetry(() => telnyx(`/conferences/${encodeURIComponent(conferenceId)}/actions/join`, {
    method: 'POST',
    body: JSON.stringify({ call_control_id: callControlId, beep_enabled: 'never', command_id: commandId }),
  }));
}

async function restoreDirectCalls(activePair: OutboundCallPair, heldPair: OutboundCallPair, conferenceId: string, joinedCallControlIds: string[], room: string) {
  if (conferenceId) {
    await Promise.all(joinedCallControlIds.map((id) => telnyx(`/conferences/${encodeURIComponent(conferenceId)}/actions/leave`, {
      method: 'POST',
      body: JSON.stringify({ call_control_id: id, beep_enabled: 'never', command_id: `vocivo-merge-leave-${room}-${id.slice(-8)}` }),
    }).catch(() => undefined)));
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  try {
    await Promise.all([
      bridgeOutboundCalls(activePair.clientCallControlId, liveOutboundDestinationId(activePair), `vocivo-merge-rollback-active-${room}`),
      bridgeOutboundCalls(heldPair.clientCallControlId, liveOutboundDestinationId(heldPair), `vocivo-merge-rollback-held-${room}`),
    ]);
    const updatedAt = new Date().toISOString();
    await Promise.all([
      updateOutboundCallPair(activePair, (current) => ({
        ...current,
        status: 'direct',
        conferenceId: undefined,
        conferenceRole: undefined,
        peerClientCallControlId: undefined,
        peerDestinationCallControlId: undefined,
        updatedAt,
      })),
      updateOutboundCallPair(heldPair, (current) => ({
        ...current,
        status: 'direct',
        conferenceId: undefined,
        conferenceRole: undefined,
        peerClientCallControlId: undefined,
        peerDestinationCallControlId: undefined,
        updatedAt,
      })),
    ]);
  } catch (rollbackError) {
    await Promise.all([
      activePair.clientCallControlId,
      liveOutboundDestinationId(activePair),
      heldPair.clientCallControlId,
      liveOutboundDestinationId(heldPair),
    ].map((id) => callAction(id, 'hangup', { command_id: `vocivo-merge-abort-${room}-${id.slice(-8)}` }).catch(() => undefined)));
    await Promise.all([activePair.routeId, heldPair.routeId].filter((id): id is string => Boolean(id)).map((id) => updateVoiceRoute(id, { phase: 'failed', failureCause: 'merge_rollback_failed' })));
    throw rollbackError;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const session = await requireSession(req);
    const config = await readPbxConfig();
    if (!config.organizations.some((organization) => organization.id === session.organizationId && organization.status === 'active')) return res.status(403).json({ error: 'An active calling account is required to manage a conference.' });
    if (req.body?.action === 'remove_participant') {
      const routeId = typeof req.body?.routeId === 'string' ? req.body.routeId.trim() : '';
      const conferenceId = typeof req.body?.conferenceId === 'string' ? req.body.conferenceId.trim() : '';
      if (!isVoiceRouteId(routeId) || !conferenceId) return res.status(400).json({ error: 'Choose a valid conference participant.' });
      const reservation = await readVoiceRoute(routeId);
      if (!reservation || reservation.userId !== session.sub) return res.status(403).json({ error: 'This conference participant does not belong to your account.' });
      const pair = await waitForPair(readOutboundCallPairByRoute, routeId);
      if (!pair || pair.status !== 'conference' || pair.conferenceId !== conferenceId) return res.status(409).json({ error: 'This participant is no longer in the conference.' });
      const leaveId = liveOutboundDestinationId(pair);
      await telnyx(`/conferences/${encodeURIComponent(conferenceId)}/actions/leave`, {
        method: 'POST',
        body: JSON.stringify({ call_control_id: leaveId, beep_enabled: 'never', command_id: `vocivo-remove-${Date.now()}` }),
      }).catch((error) => {
        if (!(error instanceof TelnyxApiError && error.code === '90018')) throw error;
      });
      await hangupConferenceParticipant(pair, leaveId, `vocivo-remove-${Date.now()}`);
      await updateVoiceRoute(routeId, { phase: 'ended' });
      return res.status(200).json({ removed: true, routeId, conferenceId });
    }
    const routeIds = Array.isArray(req.body?.routeIds)
      ? Array.from(new Set<string>(req.body.routeIds.filter((value: unknown): value is string => typeof value === 'string').map((value: string) => value.trim())))
      : [];
    if (routeIds.length !== 2 || routeIds.some((id) => !isVoiceRouteId(id))) {
      return res.status(400).json({ error: 'Two connected call legs are required before merging.' });
    }
    const reservations = await Promise.all(routeIds.map(readVoiceRoute));
    if (reservations.some((route) => !route || route.userId !== session.sub || route.organizationId !== session.organizationId || route.phase !== 'connected')) {
      return res.status(403).json({ error: 'Both calls must belong to this account and be connected before merging.' });
    }
    if (reservations.some((route) => route?.flow === 'internal')) await requireFeature(session, 'internalCalling', config);
    if (reservations.some((route) => route?.flow === 'outbound')) await requireFeature(session, 'outboundCalling', config);
    const pairs = await Promise.all(routeIds.map((id) => waitForPair(readOutboundCallPairByRoute, id)));
    if (pairs.some((pair) => !pair || pair.status !== 'direct')) {
      return res.status(409).json({ error: 'Both calls must be connected through Vocivo before they can be merged.' });
    }
    const [activePair, heldPair] = pairs;
    if (!activePair || !heldPair) return res.status(409).json({ error: 'The live call pairing could not be found.' });
    if (activePair.clientCallControlId === heldPair.clientCallControlId) return res.status(409).json({ error: 'Choose two different live calls to merge.' });
    const now = new Date().toISOString();
    await Promise.all([
      saveOutboundCallPair({ ...activePair, status: 'merging', peerClientCallControlId: heldPair.clientCallControlId, peerDestinationCallControlId: liveOutboundDestinationId(heldPair), updatedAt: now }),
      saveOutboundCallPair({ ...heldPair, status: 'merging', peerClientCallControlId: activePair.clientCallControlId, peerDestinationCallControlId: liveOutboundDestinationId(activePair), updatedAt: now }),
    ]);

    const room = `vocivo-merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let conferenceId = '';
    const joinedCallControlIds: string[] = [];
    try {
      await Promise.all([
        activePair.clientCallControlId,
        liveOutboundDestinationId(activePair),
        heldPair.clientCallControlId,
        liveOutboundDestinationId(heldPair),
      ].map((id) => {
        if (!id) throw new Error('A live destination could not be found for this merge.');
        return requireLiveCall(id);
      }));
      await new Promise((resolve) => setTimeout(resolve, 300));

      const conferenceResponse = await withConferenceRetry(() => telnyx('/conferences', {
          method: 'POST',
          body: JSON.stringify({
            call_control_id: liveOutboundDestinationId(activePair),
            name: room,
            beep_enabled: 'never',
            max_participants: 6,
            comfort_noise: true,
            command_id: `vocivo-merge-create-${room}`,
          }),
        }));
      const conferencePayload = await conferenceResponse.json() as { data?: { id?: string } };
      conferenceId = conferencePayload.data?.id || '';
      if (!conferenceId) throw new Error('Telnyx did not return a conference identifier.');
      joinedCallControlIds.push(liveOutboundDestinationId(activePair));

      for (const participantCallControlId of [liveOutboundDestinationId(heldPair), activePair.clientCallControlId]) {
        await joinConference(conferenceId, participantCallControlId, `vocivo-merge-join-${room}-${joinedCallControlIds.length}`);
        joinedCallControlIds.push(participantCallControlId);
      }

      const updatedAt = new Date().toISOString();
      await Promise.all([
        saveOutboundCallPair({ ...activePair, status: 'conference', conferenceId, conferenceRole: 'host', peerClientCallControlId: heldPair.clientCallControlId, peerDestinationCallControlId: liveOutboundDestinationId(heldPair), updatedAt }),
        saveOutboundCallPair({ ...heldPair, status: 'conference', conferenceId, conferenceRole: 'released', peerClientCallControlId: activePair.clientCallControlId, peerDestinationCallControlId: liveOutboundDestinationId(activePair), updatedAt }),
      ]);
      await callAction(heldPair.clientCallControlId, 'hangup', { command_id: `vocivo-merge-release-${room}` }).catch((error) => {
        if (!(error instanceof TelnyxApiError && error.code === '90018')) throw error;
      });
    } catch (joinError) {
      await restoreDirectCalls(activePair, heldPair, conferenceId, joinedCallControlIds, room).catch((rollbackError) => {
        console.error('Vocivo could not restore calls after a merge failure', rollbackError);
      });
      throw joinError;
    }

    return res.status(200).json({ merged: true, conferenceId, room, participants: 3 });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'This calling feature is not enabled for your account.' });
    if (error instanceof TelnyxApiError && [400, 404, 409, 422].includes(error.status)) {
      return res.status(409).json({ error: `Telnyx could not merge these calls: ${error.message}` });
    }
    return res.status(500).json({ error: publicError(error) });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { telnyx, TelnyxApiError } from '../telnyx.js';
import { readOutboundCallPairByClient, readOutboundCallPairByRoute, saveOutboundCallPair, type OutboundCallPair } from '../outbound-call-store.js';
import { callAction } from '../voice-control.js';
import { isVoiceRouteId } from '../voice-route-id.js';

const callControlIdPattern = /^[A-Za-z0-9:_-]{16,256}$/;

async function waitForPair(reader: (id: string) => Promise<OutboundCallPair | null>, id: string) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const pair = await reader(id);
    if (pair) return pair;
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    await requireSession(req);
    const routeIds = Array.isArray(req.body?.routeIds)
      ? Array.from(new Set<string>(req.body.routeIds.filter((value: unknown): value is string => typeof value === 'string').map((value: string) => value.trim())))
      : [];
    const callControlIds = Array.isArray(req.body?.callControlIds)
      ? Array.from(new Set<string>(req.body.callControlIds.filter((value: unknown): value is string => typeof value === 'string').map((value: string) => value.trim())))
      : [];

    const usesRouteIds = routeIds.length > 0;
    const identifiers = usesRouteIds ? routeIds : callControlIds;
    const invalidIdentifier = usesRouteIds
      ? identifiers.some((id) => !isVoiceRouteId(id))
      : identifiers.some((id) => !callControlIdPattern.test(id));
    if (identifiers.length !== 2 || invalidIdentifier) {
      return res.status(400).json({ error: 'Two connected call legs are required before merging.' });
    }

    const reader = usesRouteIds ? readOutboundCallPairByRoute : readOutboundCallPairByClient;
    const pairs = await Promise.all(identifiers.map((id) => waitForPair(reader, id)));
    if (pairs.some((pair) => !pair || pair.status !== 'direct')) {
      return res.status(409).json({ error: 'Both calls must be connected through Vocivo before they can be merged.' });
    }
    const [activePair, heldPair] = pairs;
    if (!activePair || !heldPair) return res.status(409).json({ error: 'The live call pairing could not be found.' });
    if (activePair.clientCallControlId === heldPair.clientCallControlId) return res.status(409).json({ error: 'Choose two different live calls to merge.' });
    const now = new Date().toISOString();
    await Promise.all([
      saveOutboundCallPair({ ...activePair, status: 'merging', updatedAt: now }),
      saveOutboundCallPair({ ...heldPair, status: 'merging', updatedAt: now }),
    ]);

    const room = `vocivo-merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let conferenceId = '';
    const joinedCallControlIds: string[] = [];
    try {
      const conferenceResponse = await telnyx('/conferences', {
        method: 'POST',
        body: JSON.stringify({
          call_control_id: activePair.destinationCallControlId,
          name: room,
          beep_enabled: 'on_enter',
          max_participants: 6,
          comfort_noise: true,
          command_id: `vocivo-merge-create-${room}`,
        }),
      });
      const conferencePayload = await conferenceResponse.json() as { data?: { id?: string } };
      conferenceId = conferencePayload.data?.id || '';
      if (!conferenceId) throw new Error('Telnyx did not return a conference identifier.');
      joinedCallControlIds.push(activePair.destinationCallControlId);

      for (const participantCallControlId of [heldPair.destinationCallControlId, activePair.clientCallControlId]) {
        await telnyx(`/conferences/${encodeURIComponent(conferenceId)}/actions/join`, {
          method: 'POST',
          body: JSON.stringify({ call_control_id: participantCallControlId, beep_enabled: 'on_enter', command_id: `vocivo-merge-join-${room}-${joinedCallControlIds.length}` }),
        });
        joinedCallControlIds.push(participantCallControlId);
      }

      const updatedAt = new Date().toISOString();
      await Promise.all([
        saveOutboundCallPair({ ...activePair, status: 'conference', conferenceId, conferenceRole: 'host', peerClientCallControlId: heldPair.clientCallControlId, peerDestinationCallControlId: heldPair.destinationCallControlId, updatedAt }),
        saveOutboundCallPair({ ...heldPair, status: 'conference', conferenceId, conferenceRole: 'released', peerClientCallControlId: activePair.clientCallControlId, peerDestinationCallControlId: activePair.destinationCallControlId, updatedAt }),
      ]);
      await callAction(heldPair.clientCallControlId, 'hangup', { command_id: `vocivo-merge-release-${Date.now()}` });
    } catch (joinError) {
      if (conferenceId) {
        await Promise.all(joinedCallControlIds.map((id) => telnyx(`/conferences/${encodeURIComponent(conferenceId)}/actions/leave`, {
          method: 'POST', body: JSON.stringify({ call_control_id: id }),
        }).catch(() => undefined)));
      }
      await Promise.all([
        callAction(activePair.clientCallControlId, 'bridge', { call_control_id: activePair.destinationCallControlId, park_after_unbridge: 'self', command_id: `vocivo-merge-rollback-active-${room}` }).catch(() => undefined),
        callAction(heldPair.clientCallControlId, 'bridge', { call_control_id: heldPair.destinationCallControlId, park_after_unbridge: 'self', command_id: `vocivo-merge-rollback-held-${room}` }).catch(() => undefined),
        saveOutboundCallPair({ ...activePair, status: 'direct', updatedAt: new Date().toISOString() }),
        saveOutboundCallPair({ ...heldPair, status: 'direct', updatedAt: new Date().toISOString() }),
      ]);
      throw joinError;
    }

    return res.status(200).json({ merged: true, conferenceId, room, participants: 3 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof TelnyxApiError && [400, 404, 409, 422].includes(error.status)) {
      return res.status(409).json({ error: `Telnyx could not merge these calls: ${error.message}` });
    }
    return res.status(500).json({ error: publicError(error) });
  }
}

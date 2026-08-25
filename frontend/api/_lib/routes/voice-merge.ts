import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { telnyx, TelnyxApiError } from '../telnyx.js';
import { readOutboundCallPairByClient, saveOutboundCallPair } from '../outbound-call-store.js';
import { callAction } from '../voice-control.js';

const callControlIdPattern = /^[A-Za-z0-9:_-]{16,256}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    await requireSession(req);
    const callControlIds = Array.isArray(req.body?.callControlIds)
      ? Array.from(new Set<string>(req.body.callControlIds.filter((value: unknown): value is string => typeof value === 'string').map((value: string) => value.trim())))
      : [];

    if (callControlIds.length !== 2 || callControlIds.some((id) => !callControlIdPattern.test(id))) {
      return res.status(400).json({ error: 'Two connected call legs are required before merging.' });
    }

    const pairs = await Promise.all(callControlIds.map(readOutboundCallPairByClient));
    if (pairs.some((pair) => !pair || pair.status !== 'direct')) {
      return res.status(409).json({ error: 'These calls were not placed through the merge-capable Vocivo route. End them and place both calls again.' });
    }
    const [activePair, heldPair] = pairs;
    if (!activePair || !heldPair) return res.status(409).json({ error: 'The live call pairing could not be found.' });
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
          call_control_id: activePair.clientCallControlId,
          name: room,
          beep_enabled: 'on_enter',
          max_participants: 6,
          comfort_noise: true,
        }),
      });
      const conferencePayload = await conferenceResponse.json() as { data?: { id?: string } };
      conferenceId = conferencePayload.data?.id || '';
      if (!conferenceId) throw new Error('Telnyx did not return a conference identifier.');
      joinedCallControlIds.push(activePair.clientCallControlId);

      for (const destinationCallControlId of [activePair.destinationCallControlId, heldPair.destinationCallControlId]) {
        await telnyx(`/conferences/${encodeURIComponent(conferenceId)}/actions/join`, {
          method: 'POST',
          body: JSON.stringify({ call_control_id: destinationCallControlId, beep_enabled: 'on_enter' }),
        });
        joinedCallControlIds.push(destinationCallControlId);
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
        callAction(activePair.clientCallControlId, 'bridge', { call_control_id: activePair.destinationCallControlId }).catch(() => undefined),
        callAction(heldPair.clientCallControlId, 'bridge', { call_control_id: heldPair.destinationCallControlId }).catch(() => undefined),
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

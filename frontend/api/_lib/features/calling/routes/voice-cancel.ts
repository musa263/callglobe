import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { hangupCallControlIds, hangupConferenceParticipant, terminateOutboundPair } from '../outbound-cancel.js';
import { liveOutboundDestinationId, readOutboundCallPairByRoute } from '../outbound-call-store.js';
import { sessionMayControlVoiceRoute } from '../voice-route-control.js';
import { isVoiceRouteId } from '../voice-route-id.js';
import { readVoiceRoute, updateVoiceRoute } from '../voice-route-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const session = await requireSession(req);
    const routeId = typeof req.body?.routeId === 'string' ? req.body.routeId.trim() : '';
    if (!isVoiceRouteId(routeId)) return res.status(400).json({ error: 'A valid call route is required.' });
    const route = await readVoiceRoute(routeId);
    if (!route || !sessionMayControlVoiceRoute(session, route)) return res.status(404).json({ error: 'Call route not found.' });
    const destHangup = Boolean(session.extensionId && session.extensionId === route.destinationExtensionId && route.userId !== session.sub);

    const pair = await readOutboundCallPairByRoute(routeId);
    if (pair) {
      if (pair.status === 'conference' && pair.conferenceRole !== 'host') {
        await hangupConferenceParticipant(pair, liveOutboundDestinationId(pair) || pair.destinationCallControlId, `cancel-${routeId.slice(-10)}`);
      } else {
        await terminateOutboundPair(pair, `cancel-${routeId.slice(-10)}`);
      }
    }
    if (route.wakeupCallControlIds?.length) {
      await hangupCallControlIds(route.wakeupCallControlIds, `sip-cancel-${routeId.slice(-10)}`);
    }
    await updateVoiceRoute(routeId, { phase: 'ended', failureCause: destHangup ? 'callee_rejected' : 'caller_hangup' });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ canceled: true });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    return res.status(500).json({ error: publicError(error) });
  }
}

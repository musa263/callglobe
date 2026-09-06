import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { hangupCallControlIds, hangupConferenceParticipant, terminateOutboundPair } from '../outbound-cancel.js';
import { liveOutboundDestinationId, readOutboundCallPairByRoute } from '../outbound-call-store.js';
import { sessionMayControlVoiceRoute } from '../voice-route-control.js';
import { isVoiceRouteId } from '../voice-route-id.js';
import { readVoiceRoute, updateVoiceRoute } from '../voice-route-store.js';

const defaultDependencies = { requireSession, readVoiceRoute, sessionMayControlVoiceRoute, readOutboundCallPairByRoute, hangupConferenceParticipant, terminateOutboundPair, hangupCallControlIds, updateVoiceRoute };

export function createVoiceCancelHandler(dependencies: Partial<typeof defaultDependencies> = {}) {
  const { requireSession, readVoiceRoute, sessionMayControlVoiceRoute, readOutboundCallPairByRoute, hangupConferenceParticipant, terminateOutboundPair, hangupCallControlIds, updateVoiceRoute } = { ...defaultDependencies, ...dependencies };
  return async function handler(req: VercelRequest, res: VercelResponse) {
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
    let complete = true;
    if (pair) {
      if (pair.status === 'conference' && pair.conferenceRole !== 'host') {
        complete = await hangupConferenceParticipant(pair, liveOutboundDestinationId(pair) || pair.destinationCallControlId, `cancel-${routeId.slice(-10)}`);
      } else {
        complete = (await terminateOutboundPair(pair, `cancel-${routeId.slice(-10)}`)).complete;
      }
    }
    if (route.wakeupCallControlIds?.length) {
      const wakeupsComplete = await hangupCallControlIds(route.wakeupCallControlIds, `sip-cancel-${routeId.slice(-10)}`);
      complete = complete && wakeupsComplete;
    }
    if (!complete) {
      res.setHeader('Retry-After', '2');
      return res.status(503).json({ canceled: false, error: 'Call cancellation is pending. Please retry.' });
    }
    const ended = await updateVoiceRoute(routeId, { phase: 'ended', failureCause: destHangup ? 'callee_rejected' : 'caller_hangup' });
    if (!ended) return res.status(503).json({ canceled: false, error: 'Call cancellation state could not be confirmed. Please retry.' });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ canceled: true });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    return res.status(500).json({ error: publicError(error) });
  }
  };
}

export default createVoiceCancelHandler();

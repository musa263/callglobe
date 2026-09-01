import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../http.js';
import { prepareParkedCallerMedia } from '../outbound-bridge.js';
import { readOutboundCallPairByRoute } from '../outbound-call-store.js';
import { isVoiceRouteId } from '../voice-route-id.js';
import { sessionMayControlVoiceRoute } from '../voice-route-control.js';
import { readVoiceRoute, updateVoiceRoute } from '../voice-route-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const session = await requireSession(req);
    const routeId = typeof req.body?.routeId === 'string' ? req.body.routeId.trim() : '';
    const event = typeof req.body?.event === 'string' ? req.body.event.trim() : '';
    if (!isVoiceRouteId(routeId)) return res.status(400).json({ error: 'A valid call route is required.' });
    if (event !== 'answered') return res.status(400).json({ error: 'Unsupported call progress event.' });
    const route = await readVoiceRoute(routeId);
    if (!route || !sessionMayControlVoiceRoute(session, route)) return res.status(404).json({ error: 'Call route not found.' });

    const pair = await readOutboundCallPairByRoute(routeId);
    if (pair?.clientCallControlId) {
      await prepareParkedCallerMedia(pair.clientCallControlId, `progress-${routeId.slice(-10)}`);
    }
    if (!['ended', 'failed'].includes(route.phase)) {
      await updateVoiceRoute(routeId, { phase: 'connected', connectedAt: new Date().toISOString() });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ progressed: true });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    return res.status(500).json({ error: publicError(error) });
  }
}

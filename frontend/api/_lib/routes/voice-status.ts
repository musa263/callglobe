import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { readOutboundCallPairByRoute } from '../outbound-call-store.js';
import { isVoiceRouteId } from '../voice-route-id.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    await requireSession(req);
    const routeId = typeof req.query.routeId === 'string' ? req.query.routeId : '';
    if (!isVoiceRouteId(routeId)) return res.status(400).json({ error: 'A valid call route is required.' });
    const pair = await readOutboundCallPairByRoute(routeId);
    if (!pair) return res.status(202).json({ phase: 'dialing' });
    return res.status(200).json({
      phase: pair.phase || (pair.status === 'conference' ? 'connected' : 'ringing'),
      connectedAt: pair.connectedAt,
      failureCause: pair.failureCause,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

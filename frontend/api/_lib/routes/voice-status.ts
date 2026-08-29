import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { isVoiceRouteId } from '../voice-route-id.js';
import { readVoiceRoute } from '../voice-route-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const session = await requireSession(req);
    const routeId = typeof req.query.routeId === 'string' ? req.query.routeId : '';
    if (!isVoiceRouteId(routeId)) return res.status(400).json({ error: 'A valid call route is required.' });
    const route = await readVoiceRoute(routeId);
    if (!route || route.userId !== session.sub) return res.status(404).json({ error: 'Call route not found.' });
    return res.status(200).json({
      phase: route.phase,
      connectedAt: route.connectedAt,
      // A normal carrier release is a completed call lifecycle, not a UI error.
      failureCause: route.phase === 'failed' ? route.failureCause : undefined,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

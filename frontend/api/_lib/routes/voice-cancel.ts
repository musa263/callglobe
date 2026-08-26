import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { terminateOutboundPair } from '../outbound-cancel.js';
import { readOutboundCallPairByRoute } from '../outbound-call-store.js';
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
    if (!route || route.userId !== session.sub) return res.status(404).json({ error: 'Call route not found.' });

    await updateVoiceRoute(routeId, { phase: 'ended', failureCause: 'caller_hangup' });
    const pair = await readOutboundCallPairByRoute(routeId);
    if (pair) await terminateOutboundPair(pair, `cancel-${routeId.slice(-10)}`);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ canceled: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

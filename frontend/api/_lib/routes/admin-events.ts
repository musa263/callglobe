import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../auth.js';
import { allowMobile, methodNotAllowed } from '../http.js';
import { listCallEvents } from '../call-event-store.js';
import { requireFeature } from '../saas-access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const access = await requireAdmin(req);
    await requireFeature(access.session, 'analytics');
    const allEvents = await listCallEvents(250, access.superadmin ? undefined : access.organizationId);
    const events = access.superadmin ? allEvents.slice(0, 100) : allEvents.filter((event) => (event.organizationId || 'primary') === access.organizationId).slice(0, 100);
    res.setHeader('Cache-Control', 'private, max-age=15');
    return res.status(200).json({ events, meta: { source: 'vocivo-webhooks' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'Analytics is not enabled for this company.' });
    console.error('Call event reporting unavailable', error);
    return res.status(200).json({ events: [], meta: {}, unavailable: true });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../auth.js';
import { allowMobile, methodNotAllowed, writeAuthError } from '../http.js';
import { listCallEvents } from '../call-event-store.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { requireFeature } from '../saas-access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const access = await requireAdmin(req);
    await requireFeature(access.session, 'analytics');
    // A superadmin is looking at one customer's workspace, so they see that
    // customer's calls — the same list the customer's own administrator sees.
    const organizationId = access.superadmin ? (await readPbxConfig()).activeOrganizationId : access.organizationId;
    const allEvents = await listCallEvents(250, organizationId);
    const events = allEvents.filter((event) => event.organizationId === organizationId).slice(0, 100);
    res.setHeader('Cache-Control', 'private, max-age=15');
    return res.status(200).json({ events, meta: { source: 'vocivo-call-records', organizationId } });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'Analytics is not enabled for this company.' });
    console.error('Call event reporting unavailable', error);
    return res.status(200).json({ events: [], meta: {}, unavailable: true });
  }
}

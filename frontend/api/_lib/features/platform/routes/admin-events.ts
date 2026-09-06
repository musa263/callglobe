import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, writeAuthError } from '../../../shared/http.js';
import { listCallEvents } from '../../calling/call-event-store.js';
import { readPbxConfig } from '../../organizations/pbx-config-store.js';
import { requireFeature } from '../../organizations/saas-access.js';
import { requestOrganizationId, writeTenantScopeError } from '../../organizations/request-organization.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const access = await requireAdmin(req);
    await requireFeature(access.session, 'analytics');
    // A superadmin is looking at one customer's workspace, so they see that
    // customer's calls — the same list the customer's own administrator sees.
    const organizationId = requestOrganizationId(req, access.session, await readPbxConfig());
    const allEvents = await listCallEvents(250, organizationId);
    const events = allEvents.filter((event) => event.organizationId === organizationId).slice(0, 100);
    res.setHeader('Cache-Control', 'private, max-age=15');
    return res.status(200).json({ events, meta: { source: 'vocivo-call-records', organizationId } });
  } catch (error) {
    if (writeTenantScopeError(res, error)) return;
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'Analytics is not enabled for this company.' });
    console.error('Call event reporting unavailable', error);
    return res.status(200).json({ events: [], meta: {}, unavailable: true });
  }
}

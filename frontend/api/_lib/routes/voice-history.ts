import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { listCallEvents } from '../call-event-store.js';
import { callHistoryFromEvents } from '../call-history.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../http.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { sessionOrganizationId } from '../tenancy.js';
import { listExtensions } from '../pbx.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const session = await requireSession(req);
    const organizationId = sessionOrganizationId(session, await readPbxConfig());
    const [directory, events] = await Promise.all([listExtensions(organizationId), listCallEvents(250, organizationId)]);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      calls: callHistoryFromEvents(events, organizationId, 100, {
        extensionId: session.extensionId,
        extension: session.extension,
        viewAll: ['owner', 'admin', 'superadmin', 'company_owner', 'company_admin'].includes(session.role || ''),
        directory: directory.map(({ id, extension, name, sipUsername }) => ({ id, extension, name, sipUsername })),
      }),
    });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    return res.status(500).json({ error: publicError(error) });
  }
}

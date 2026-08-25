import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed } from '../http.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const session = await requireSession(req);
    const isOwner = session.sub === 'vocivo-owner';
    return res.status(200).json({
      profile: {
        id: session.sub,
        email: session.email,
        full_name: isOwner ? process.env.APP_ADMIN_NAME || 'Vocivo Owner' : session.name || `Extension ${session.extension || ''}`,
        currency: 'USD',
        extension: session.extension,
        organization_id: session.organizationId,
        role: session.role,
      },
    });
  } catch {
    return res.status(401).json({ error: 'Session expired.' });
  }
}

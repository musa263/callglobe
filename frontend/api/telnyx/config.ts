import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../_lib/auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../_lib/http.js';
import { getExtensionCredentials } from '../_lib/pbx.js';
import { accessForSession } from '../_lib/saas-access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const session = await requireSession(req);
    if (session.sub === 'vocivo-owner') return res.status(403).json({ error: 'Platform administrators do not have a calling extension.' });
    const access = await accessForSession(session);
    if (access.superadmin === false && !access.features.internalCalling && !access.features.outboundCalling) return res.status(403).json({ error: 'Calling is not enabled for this account.' });
    if (session.extensionId) {
      const credential = await getExtensionCredentials(session.extensionId);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ sip_user: credential.sipUsername, sip_password: credential.sipPassword, extension: credential.extension.extension });
    }
    return res.status(403).json({ error: 'This administrator account does not have a calling extension.' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && ['Organization inactive', 'Subscription inactive'].includes(error.message)) return res.status(403).json({ error: 'Calling is unavailable while this company account is inactive.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

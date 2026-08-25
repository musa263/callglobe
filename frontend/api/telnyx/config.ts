import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../_lib/auth.js';
import { allowMobile, methodNotAllowed, publicError, requiredEnv } from '../_lib/http.js';
import { telnyx } from '../_lib/telnyx.js';
import { getExtensionCredentials } from '../_lib/pbx.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const session = await requireSession(req);
    if (session.extensionId) {
      const credential = await getExtensionCredentials(session.extensionId);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ sip_user: credential.sipUsername, sip_password: credential.sipPassword, extension: credential.extension.extension });
    }
    const connectionId = requiredEnv('TELNYX_CONNECTION_ID');
    const response = await telnyx(`/credential_connections/${connectionId}`);
    const payload = await response.json();
    const sipUser = payload?.data?.user_name;
    const sipPassword = payload?.data?.password;
    if (!sipUser || !sipPassword) throw new Error('Telnyx did not return SIP credentials.');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ sip_user: sipUser, sip_password: sipPassword });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

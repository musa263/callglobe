import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../_lib/auth.js';
import { allowMobile, methodNotAllowed, publicError, requiredEnv } from '../_lib/http.js';
import { telnyx } from '../_lib/telnyx.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    await requireSession(req);
    const credentialId = requiredEnv('TELNYX_CREDENTIAL_ID');
    const response = await telnyx(`/telephony_credentials/${credentialId}/token`, { method: 'POST' });
    const token = await response.text();
    if (!token) throw new Error('Telnyx did not return a voice token.');
    return res.status(200).json({ token, expires_in: 86400 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

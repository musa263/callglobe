import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { issueSipNonce, sipEdgeAuthorized } from '../sip-edge-auth.js';
import { sipRealm } from '../voice-provider.js';

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    if (!sipEdgeAuthorized(req)) return res.status(401).json({ error: 'SIP edge authentication failed.', ok: false });
    const username = text(req.body?.username, 80);
    if (!username) return res.status(400).json({ error: 'A SIP username is required.', ok: false });
    return res.status(200).json({
      ok: true,
      nonce: issueSipNonce(username),
      realm: sipRealm(),
      qop: 'auth',
    });
  } catch (error) {
    return res.status(500).json({ error: publicError(error), ok: false });
  }
}

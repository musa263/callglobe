import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { issueSipNonce, sipEdgeAuthorized } from '../sip-edge-auth.js';

/**
 * Server-issued Digest nonces for the SIP edge. Kamailio's CHALLENGE route
 * asks here before it sends a 401; sip-auth then accepts an answer only to a
 * nonce this issued and that has not expired. Without this the edge fell back
 * to nonces nobody verified, and a captured Authorization header worked
 * forever.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    if (!sipEdgeAuthorized(req)) return res.status(401).json({ error: 'SIP edge authentication failed.' });
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().slice(0, 80) : '';
    if (!/^[A-Za-z0-9_.+-]{1,80}$/.test(username)) return res.status(400).json({ error: 'A SIP username is required.' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ nonce: issueSipNonce(username) });
  } catch (error) {
    return res.status(500).json({ error: publicError(error) });
  }
}

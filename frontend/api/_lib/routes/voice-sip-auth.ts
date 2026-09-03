import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { digestMatches, parseDigestAuthorization, type DigestChallenge } from '../sip-digest.js';
import { readSipCredential } from '../sip-credential-store.js';
import { sipEdgeAuthorized, sipNonceIsValid } from '../sip-edge-auth.js';

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    if (!sipEdgeAuthorized(req)) return res.status(401).json({ error: 'SIP edge authentication failed.', ok: false });
    const fromHeader = parseDigestAuthorization(text(req.body?.authorization, 1200), text(req.body?.method, 16) || 'REGISTER');
    const challenge: DigestChallenge = fromHeader || {
      username: text(req.body?.username, 80),
      realm: text(req.body?.realm, 120),
      nonce: text(req.body?.nonce, 200),
      uri: text(req.body?.uri, 300),
      response: text(req.body?.response, 64),
      method: text(req.body?.method, 16).toUpperCase() || 'REGISTER',
      cnonce: text(req.body?.cnonce, 80) || undefined,
      nc: text(req.body?.nc, 16) || undefined,
      qop: text(req.body?.qop, 16) || undefined,
    };
    if (!challenge.username || !challenge.realm || !challenge.nonce || !challenge.uri || !challenge.response) {
      return res.status(400).json({ error: 'A complete Digest challenge is required.', ok: false });
    }
    // Only an answer to a nonce this API issued, and recently, counts. A
    // digest is otherwise replayable for as long as the password stands.
    if (!sipNonceIsValid(challenge.nonce, challenge.username)) return res.status(403).json({ ok: false, reason: 'stale_nonce' });
    const stored = await readSipCredential(challenge.username);
    if (!stored || stored.realm !== challenge.realm) return res.status(403).json({ ok: false });
    const ok = digestMatches(stored.ha1, challenge);
    return res.status(ok ? 200 : 403).json({
      ok,
      extensionId: ok ? stored.extensionId : undefined,
      organizationId: ok ? stored.organizationId : undefined,
    });
  } catch (error) {
    return res.status(500).json({ error: publicError(error), ok: false });
  }
}

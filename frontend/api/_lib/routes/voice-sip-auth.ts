import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { authorizeSipCall, type SipCallAuthorization } from '../sip-call-authorization.js';
import { digestMatches, parseDigestAuthorization, type DigestChallenge } from '../sip-digest.js';
import { readSipCredential } from '../sip-credential-store.js';
import { sipEdgeAuthorized, sipNonceIsValid } from '../sip-edge-auth.js';

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * What the edge may put on the wire for this call. Only ever sent alongside a
 * verified route token, and only ever the API's own values: Kamailio appends
 * these as `X-Vocivo-Caller-ID` and `X-Vocivo-Route-ID` in place of whatever
 * the client claimed.
 */
function routeFields(call: SipCallAuthorization | null) {
  if (!call) return {};
  return { routeId: call.routeId, callerId: call.callerId, routeFlow: call.flow, routeOrganizationId: call.organizationId };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    if (!sipEdgeAuthorized(req)) return res.status(401).json({ error: 'SIP edge authentication failed.', ok: false });
    const routeToken = text(req.body?.routeToken, 2000);
    const requestUser = text(req.body?.requestUser, 120);
    const suppliedAuthorization = text(req.body?.authorization, 1200);
    const suppliedResponse = text(req.body?.response, 64);

    // An internal call between two extensions carries no Digest of its own —
    // the phone authenticated when it registered. What it carries is the route
    // token the API issued for this one call, and that alone decides whether
    // the edge may connect it.
    if (!suppliedAuthorization && !suppliedResponse) {
      if (!routeToken) return res.status(400).json({ error: 'A Digest challenge or a route token is required.', ok: false });
      const call = authorizeSipCall({ routeToken, requestUser });
      return res.status(call ? 200 : 403).json({ ok: false, ...routeFields(call) });
    }

    const fromHeader = parseDigestAuthorization(suppliedAuthorization, text(req.body?.method, 16) || 'REGISTER');
    const challenge: DigestChallenge = fromHeader || {
      username: text(req.body?.username, 80),
      realm: text(req.body?.realm, 120),
      nonce: text(req.body?.nonce, 200),
      uri: text(req.body?.uri, 300),
      response: suppliedResponse,
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
    // The route is only vouched for once the password has been: a caller ID
    // returned beside a failed Digest would be a caller ID for the asking.
    const call = ok && routeToken
      ? authorizeSipCall({ routeToken, requestUser, organizationId: stored.organizationId })
      : null;
    return res.status(ok ? 200 : 403).json({
      ok,
      extensionId: ok ? stored.extensionId : undefined,
      organizationId: ok ? stored.organizationId : undefined,
      ...routeFields(call),
    });
  } catch (error) {
    return res.status(500).json({ error: publicError(error), ok: false });
  }
}

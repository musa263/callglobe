import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { maybeChargeOutboundHangup } from '../outbound-pstn-charge.js';
import { sipEdgeAuthorized } from '../sip-edge-auth.js';

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    if (!sipEdgeAuthorized(req)) return res.status(401).json({ error: 'SIP edge authentication failed.', ok: false });
    const routeId = text(req.body?.routeId, 120);
    const eventId = text(req.body?.eventId, 120) || `sip-hangup-${Date.now()}`;
    const durationSeconds = Number(req.body?.durationSeconds);
    const result = await maybeChargeOutboundHangup(
      routeId,
      eventId,
      Number.isFinite(durationSeconds) ? durationSeconds : undefined,
    );
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({ error: publicError(error), ok: false });
  }
}

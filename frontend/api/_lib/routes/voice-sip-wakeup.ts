import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { listExtensions } from '../pbx.js';
import { wakeMobileDevices } from '../mobile-push-dispatcher.js';
import { sipEdgeAuthorized } from '../sip-edge-auth.js';
import { sendIncomingCallWebPush } from '../web-push-dispatcher.js';

/** Kamailio holds the INVITE for one 8 s window, so the push must outlive nothing longer. */
const WAKE_TTL_SECONDS = 45;

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    if (!sipEdgeAuthorized(req)) return res.status(401).json({ error: 'SIP edge authentication failed.' });
    const username = text(req.body?.username, 80);
    const callId = text(req.body?.callId, 120) || `sip-${Date.now()}`;
    const callerName = text(req.body?.callerName, 80);
    const callerNumber = text(req.body?.from, 40);
    if (!username) return res.status(400).json({ error: 'A SIP username is required.' });
    const directory = await listExtensions();
    const matches = directory.filter((item) => item.status === 'active' && item.sipUsername === username);
    const extensionIds = matches.map((item) => item.id);
    const organizationIds = [...new Set(matches.map((item) => item.organizationId))];
    const web = await Promise.all(organizationIds.map((organizationId) => sendIncomingCallWebPush({
      organizationId,
      extensionIds,
      callerName,
      callId,
    })));
    // The phone is the product: for a mobile PBX the app is normally killed, so
    // this VoIP/FCM push is what actually makes the handset ring.
    const mobile = await wakeMobileDevices({
      targets: matches.map((item) => ({ organizationId: item.organizationId, extensionId: item.id })),
      call: {
        callId,
        sipUsername: username,
        callerName: callerName || undefined,
        callerNumber: callerNumber || undefined,
        ttlSeconds: WAKE_TTL_SECONDS,
      },
    });
    return res.status(200).json({
      ok: true,
      // Kamailio reads `uuid` and appends it as X-Vocivo-Call-UUID so the ringing
      // device can match this INVITE to the push it just received. Until Vocivo
      // mints its own call record id, echoing the SIP Call-ID is that identity.
      uuid: callId,
      webPush: web.reduce((total, item) => total + item.sent, 0),
      mobilePush: { attempted: mobile.attempted, sent: mobile.sent, pruned: mobile.pruned, unavailable: mobile.unavailable },
    });
  } catch (error) {
    return res.status(500).json({ error: publicError(error) });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { afterResponse, allowMobile, methodNotAllowed, publicError } from '../http.js';
import { listExtensions } from '../pbx.js';
import { wakeMobileDevices } from '../mobile-push-dispatcher.js';
import { sipEdgeAuthorized } from '../sip-edge-auth.js';
import { sendIncomingCallWebPush } from '../web-push-dispatcher.js';

/** Matches the maximum incoming-call notification lifetime. */
const WAKE_TTL_SECONDS = 45;

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function createSipWakeupHandler(deps = { listExtensions, wakeMobileDevices, sendIncomingCallWebPush, afterResponse }) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    if (allowMobile(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      if (!sipEdgeAuthorized(req)) return res.status(401).json({ error: 'SIP edge authentication failed.' });
      const username = text(req.body?.username, 80);
      const callId = text(req.body?.callId, 120);
      const callerName = text(req.body?.callerName, 80);
      const callerNumber = text(req.body?.from, 40);
      if (!username) return res.status(400).json({ error: 'A SIP username is required.' });
      if (!callId) return res.status(400).json({ error: 'A call ID is required.' });
      const dispatch = async () => {
        const directory = await deps.listExtensions();
        const matches = directory.filter((item) => item.status === 'active' && item.sipUsername === username);
        const organizationIds = [...new Set(matches.map((item) => item.organizationId))];
        const deliveries = await Promise.allSettled([
          ...organizationIds.map((organizationId) => deps.sendIncomingCallWebPush({
            organizationId,
            extensionIds: matches.filter((item) => item.organizationId === organizationId).map((item) => item.id),
            callerName,
            callId,
          })),
          deps.wakeMobileDevices({
            targets: matches.map((item) => ({ organizationId: item.organizationId, extensionId: item.id })),
            call: {
              callId,
              sipUsername: username,
              callerName: callerName || undefined,
              callerNumber: callerNumber || undefined,
              ttlSeconds: WAKE_TTL_SECONDS,
            },
          }),
        ]);
        for (const delivery of deliveries) {
          if (delivery.status === 'rejected') throw delivery.reason;
        }
      };
      // Release Kamailio before directory lookup or push-provider round trips.
      deps.afterResponse('SIP incoming wakeup', dispatch());
      return res.status(200).json({ ok: true, uuid: callId, queued: true });
    } catch (error) {
      return res.status(500).json({ error: publicError(error) });
    }
  };
}

export default createSipWakeupHandler();

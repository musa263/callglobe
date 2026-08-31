import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { listExtensions } from '../pbx.js';
import { listPushDevices } from '../push-device-store.js';
import { sipEdgeAuthorized } from '../sip-edge-auth.js';
import { sendIncomingCallWebPush } from '../web-push-dispatcher.js';

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
    const devices = (await Promise.all(matches.map((item) => listPushDevices(item.organizationId, item.id)))).flat();
    return res.status(200).json({
      ok: true,
      webPush: web.reduce((total, item) => total + item.sent, 0),
      devices: devices.map((device) => ({
        platform: device.platform,
        environment: device.environment,
        extensionId: device.extensionId,
        organizationId: device.organizationId,
      })),
    });
  } catch (error) {
    return res.status(500).json({ error: publicError(error) });
  }
}

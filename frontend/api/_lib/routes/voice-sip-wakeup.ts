import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../http.js';
import { listExtensions } from '../pbx.js';
import { listPushDevices } from '../push-device-store.js';
import { sipEdgeAuthorized } from '../sip-edge-auth.js';
import { sendIncomingCallWebPush } from '../web-push-dispatcher.js';
import { sendApnsVoip, vocivoSipPushPayload } from '../apns-voip.js';
import { otherWakeupDevices, readWakeupCall, saveWakeupCall } from '../sip-wakeup-store.js';

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function ringDevices(input: { username: string; callId: string; callerName: string; from: string }) {
  const directory = await listExtensions();
  const matches = directory.filter((item) => item.status === 'active' && item.sipUsername === input.username);
  const extensionIds = matches.map((item) => item.id);
  const organizationIds = [...new Set(matches.map((item) => item.organizationId))];
  const web = await Promise.all(organizationIds.map((organizationId) => sendIncomingCallWebPush({
    organizationId,
    extensionIds,
    callerName: input.callerName || input.from,
    callId: input.callId,
  })));
  const devices = (await Promise.all(matches.map((item) => listPushDevices(item.organizationId, item.id)))).flat();
  const uuid = randomUUID();
  const payload = vocivoSipPushPayload({
    uuid,
    callId: input.callId,
    from: input.from,
    callerName: input.callerName,
    username: input.username,
  });
  const ios = devices.filter((device) => device.platform === 'ios');
  const voip = await Promise.all(ios.map((device) => sendApnsVoip({
    token: device.token,
    environment: device.environment,
    payload,
  })));
  await saveWakeupCall({
    sipCallId: input.callId,
    uuid,
    username: input.username,
    devices: devices.map((device) => ({ token: device.token, environment: device.environment, platform: device.platform })),
    createdAt: new Date().toISOString(),
  });
  return {
    ok: true,
    uuid,
    webPush: web.reduce((total, item) => total + item.sent, 0),
    voipPush: voip.filter((item) => item.sent).length,
    devices: devices.map((device) => ({
      platform: device.platform,
      environment: device.environment,
      extensionId: device.extensionId,
      organizationId: device.organizationId,
    })),
  };
}

async function cancelOtherDevices(input: { callId: string; uuid?: string; answeredToken?: string }) {
  const stored = await readWakeupCall(input.callId);
  if (!stored) return { ok: true, cancelled: 0 };
  const uuid = input.uuid || stored.uuid;
  const others = otherWakeupDevices(stored, input.answeredToken);
  const payload = vocivoSipPushPayload({ uuid, callId: input.callId, cancelled: true, username: stored.username });
  const results = await Promise.all(others.map((device) => sendApnsVoip({
    token: device.token,
    environment: device.environment,
    payload,
  })));
  return { ok: true, cancelled: results.filter((item) => item.sent).length, uuid };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    if (text(req.body?.action, 20) === 'answered') {
      const session = await requireSession(req);
      if (!session.extensionId) return res.status(403).json({ error: 'A calling extension is required.' });
      const callId = text(req.body?.callId, 120);
      if (!callId) return res.status(400).json({ error: 'callId is required.' });
      const result = await cancelOtherDevices({
        callId,
        uuid: text(req.body?.uuid, 80) || undefined,
        answeredToken: text(req.body?.token, 512) || undefined,
      });
      return res.status(200).json(result);
    }
    if (!sipEdgeAuthorized(req)) return res.status(401).json({ error: 'SIP edge authentication failed.' });
    const username = text(req.body?.username, 80);
    const callId = text(req.body?.callId, 120) || `sip-${Date.now()}`;
    const callerName = text(req.body?.callerName, 80);
    const from = text(req.body?.from, 80);
    if (!username) return res.status(400).json({ error: 'A SIP username is required.' });
    const lookup = await ringDevices({ username, callId, callerName, from });
    return res.status(200).json(lookup);
  } catch (error) {
    if (writeAuthError(res, error)) return;
    return res.status(500).json({ error: publicError(error) });
  }
}

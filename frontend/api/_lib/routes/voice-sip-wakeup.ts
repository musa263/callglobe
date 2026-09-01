import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../http.js';
import { sipEdgeAuthorized } from '../sip-edge-auth.js';
import { apnsConfigured, sendApnsVoip, vocivoSipPushPayload } from '../apns-voip.js';
import { ringSipEdgeDevices } from '../sip-ring-devices.js';
import { otherWakeupDevices, readWakeupCall } from '../sip-wakeup-store.js';

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
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
    if (!/^[A-Za-z0-9_.-]{3,80}$/.test(username)) {
      return res.status(200).json({ ok: false, skipped: 'invalid_username', apnsConfigured: apnsConfigured() });
    }
    const lookup = await ringSipEdgeDevices({ username, callId, callerName, from });
    return res.status(200).json({ ...lookup, apnsConfigured: lookup.apnsConfigured ?? apnsConfigured() });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    return res.status(500).json({ error: publicError(error) });
  }
}

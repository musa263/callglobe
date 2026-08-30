import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../http.js';
import { deletePushDevice, listPushDevices, savePushDevice, type PushDevice } from '../push-device-store.js';

function clean(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.replace(/[\r\n]/g, '').trim().slice(0, maximum) : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'POST', 'DELETE'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);
  try {
    const session = await requireSession(req);
    if (!session.extensionId || !session.extension || !session.organizationId) return res.status(403).json({ error: 'A calling extension is required.' });
    if (req.method === 'GET') {
      const devices = await listPushDevices(session.organizationId, session.extensionId);
      return res.status(200).json({ devices: devices.map(({ token: _token, ...device }) => device) });
    }
    const id = clean(req.body?.deviceId || req.query.deviceId, 100) || randomUUID();
    if (req.method === 'DELETE') {
      await deletePushDevice({ id, organizationId: session.organizationId, extensionId: session.extensionId });
      return res.status(204).end();
    }
    const platform = clean(req.body?.platform, 12) as PushDevice['platform'];
    const token = clean(req.body?.token, 512);
    if (!['ios', 'android'].includes(platform) || token.length < 32) return res.status(400).json({ error: 'A valid push token and platform are required.' });
    const device: PushDevice = {
      id,
      platform,
      token,
      extensionId: session.extensionId,
      extension: session.extension,
      organizationId: session.organizationId,
      environment: req.body?.environment === 'sandbox' ? 'sandbox' : 'production',
      bundleId: clean(req.body?.bundleId, 200) || undefined,
      appVersion: clean(req.body?.appVersion, 50) || undefined,
      updatedAt: new Date().toISOString(),
    };
    await savePushDevice(device);
    return res.status(200).json({ device: { ...device, token: undefined } });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    return res.status(500).json({ error: publicError(error) });
  }
}

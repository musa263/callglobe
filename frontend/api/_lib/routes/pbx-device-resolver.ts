import type { VercelRequest, VercelResponse } from '@vercel/node';
import { findExtension } from '../pbx.js';
import { methodNotAllowed, publicError } from '../http.js';
import { verifyPbxRequest } from '../pbx-internal-auth.js';
import { listPushDevices } from '../push-device-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    await verifyPbxRequest(req);
    const organizationId = typeof req.body?.organizationId === 'string' ? req.body.organizationId : '';
    const extensionNumber = typeof req.body?.extension === 'string' ? req.body.extension : '';
    if (!organizationId || !/^\d{2,5}$/.test(extensionNumber)) return res.status(400).json({ error: 'A valid organization and extension are required.' });
    const extension = await findExtension(extensionNumber, organizationId);
    if (!extension) return res.status(200).json({ devices: [] });
    const devices = await listPushDevices(organizationId, extension.id);
    return res.status(200).json({
      devices: devices.map((device) => ({
        platform: device.platform,
        token: device.token,
        environment: device.environment,
        bundleId: device.bundleId,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: publicError(error) });
  }
}

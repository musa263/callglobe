import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { requireSession } from '../../auth/auth.js';
import { getExtension } from '../../organizations/pbx.js';
import { readPbxConfig } from '../../organizations/pbx-config-store.js';
import { sessionOrganizationId } from '../../organizations/tenancy.js';
import { requireFeature } from '../../organizations/saas-access.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { presenceStore } from '../presence-store.js';

export function createPresenceHandler(deps = { requireSession, getExtension, readPbxConfig, requireFeature, presenceStore }) {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (allowMobile(req, res)) return;
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    try {
      const session = await deps.requireSession(req);
      const config = await deps.readPbxConfig();
      const organizationId = sessionOrganizationId(session, config);
      if (!session.extensionId) return res.status(403).json({ error: 'A calling extension is required.' });
      const extension = await deps.getExtension(session.extensionId, organizationId);
      if (extension.organizationId !== organizationId || extension.status !== 'active') return res.status(403).json({ error: 'Extension unavailable.' });
      await deps.requireFeature(session, 'internalCalling', config);
      const { instanceId, sequence, state, organizationId: requestedOrg, extensionId: requestedExtension } = req.body || {};
      if (requestedOrg !== undefined || requestedExtension !== undefined || typeof instanceId !== 'string'
        || !/^[a-zA-Z0-9-]{16,64}$/.test(instanceId) || !Number.isSafeInteger(sequence) || sequence < 1
        || !['online', 'busy', 'offline'].includes(state)) return res.status(400).json({ error: 'Invalid presence update.' });
      const device = createHash('sha256').update(JSON.stringify([session.sub, session.iat, instanceId])).digest('hex');
      await deps.presenceStore.update(organizationId, extension.id, device, sequence, state);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true });
    } catch (error) {
      if (writeAuthError(res, error)) return;
      return res.status(500).json({ error: publicError(error) });
    }
  };
}
export default createPresenceHandler();

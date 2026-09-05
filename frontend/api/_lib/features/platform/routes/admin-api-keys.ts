import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { createPlatformKey, publicPlatformKey, readPlatformKeys, revokePlatformKey } from '../platform-key-store.js';
import { readPbxConfig } from '../../organizations/pbx-config-store.js';
import { requireFeature } from '../../organizations/saas-access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'POST', 'DELETE'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);
  try {
    const access = await requireAdmin(req);
    await requireFeature(access.session, 'developerApi');
    if (req.method === 'GET') return res.status(200).json({ keys: (await readPlatformKeys()).filter((item) => access.superadmin || item.organizationId === access.organizationId).map(publicPlatformKey) });
    if (req.method === 'POST') {
      const config = await readPbxConfig();
      const created = await createPlatformKey({ ...req.body, organizationId: access.superadmin ? req.body?.organizationId || config.activeOrganizationId : access.organizationId });
      return res.status(201).json({ key: publicPlatformKey(created.item), token: created.token });
    }
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id) return res.status(400).json({ error: 'API key ID is required.' });
    const existing = (await readPlatformKeys()).find((item) => item.id === id);
    if (!existing || (!access.superadmin && existing.organizationId !== access.organizationId)) return res.status(404).json({ error: 'API key not found.' });
    return res.status(200).json({ key: publicPlatformKey(await revokePlatformKey(id)) });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'Developer API access is not enabled for this company.' });
    if (error instanceof Error && /required|not found|scope/i.test(error.message)) return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { listExtensions } from '../pbx.js';
import { readUserProfiles } from '../profile-store.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { requireFeature } from '../saas-access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const session = await requireSession(req);
    const config = await readPbxConfig();
    await requireFeature(session, 'internalCalling', config);
    const organizationId = session.organizationId || config.activeOrganizationId;
    const organization = config.organizations.find((item) => item.id === organizationId);
    if (organization?.accountType !== 'business' || !organization.internalCallingEnabled || organization.status !== 'active') return res.status(403).json({ error: 'Internal calling is not enabled for this organization.' });
    const requestedExtension = typeof req.query.extension === 'string' ? req.query.extension.replace(/\D/g, '').slice(0, 5) : '';
    const extensions = (await listExtensions(organizationId)).filter((item) => item.status === 'active' && (!requestedExtension || item.extension === requestedExtension));
    const profiles = await readUserProfiles(extensions.map((item) => `vocivo-extension:${item.id}`));
    const users = extensions.map(({ id, extension, name, department, role, sipUsername }) => {
      const profile = profiles.get(`vocivo-extension:${id}`);
      return { id, extension, name: profile?.fullName || name, department: profile?.department || department, role, sipUsername, photoUrl: profile?.photoUrl, jobTitle: profile?.jobTitle };
    });
    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.status(200).json({ users, organization });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && ['Organization inactive', 'Subscription inactive', 'Feature not enabled'].includes(error.message)) return res.status(403).json({ error: 'Internal calling is not available for this account.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

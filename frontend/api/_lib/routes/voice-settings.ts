import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { readBusinessVoiceConfig, saveBusinessVoiceConfig } from '../number-config.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { sessionOrganizationId } from '../tenancy.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'PUT'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'PUT']);
  try {
    const session = await requireSession(req);
    if (req.method === 'PUT' && !['owner', 'admin'].includes(session.role || '')) return res.status(403).json({ error: 'Organization administrator access is required.' });
    const organizationId = sessionOrganizationId(session, await readPbxConfig());
    const config = req.method === 'PUT' ? await saveBusinessVoiceConfig(req.body ?? {}, organizationId) : await readBusinessVoiceConfig(organizationId);
    return res.status(200).json({ config });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && error.message === 'Forbidden') return res.status(403).json({ error: 'Organization administrator access is required.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

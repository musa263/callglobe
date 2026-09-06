import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../../auth/auth.js';
import { afterResponse, allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { readBusinessVoiceConfig, saveBusinessVoiceConfig } from '../../numbers/number-config.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { prerenderTenantPrompts } from '../../ai/prompt-prerender.js';
import { requestOrganizationId, writeTenantScopeError } from '../request-organization.js';
import { requireFeature } from '../saas-access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'PUT'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'PUT']);
  try {
    const session = await requireSession(req);
    if (req.method === 'PUT' && !['owner', 'admin', 'superadmin', 'company_owner', 'company_admin'].includes(session.role || '')) return res.status(403).json({ error: 'Organization administrator access is required.' });
    const pbx = await readPbxConfig();
    if (req.method === 'PUT' && req.body?.enabled) await requireFeature(session, 'ivr', pbx);
    if (req.method === 'PUT' && req.body?.backgroundImageUrl) await requireFeature(session, 'customBranding', pbx);
    const organizationId = requestOrganizationId(req, session, pbx);
    if (!pbx.organizations.some((organization) => organization.id === organizationId && organization.accountType === 'business' && organization.status === 'active')) {
      return res.status(403).json({ error: 'An active company account is required.' });
    }
    const config = req.method === 'PUT' ? await saveBusinessVoiceConfig(req.body ?? {}, organizationId) : await readBusinessVoiceConfig(organizationId);
    // A new greeting, menu or voice is rendered before anyone calls it.
    if (req.method === 'PUT') afterResponse('menu prompt pre-render', prerenderTenantPrompts(organizationId, { config: pbx }));
    return res.status(200).json({ config });
  } catch (error) {
    if (writeTenantScopeError(res, error)) return;
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && error.message === 'Forbidden') return res.status(403).json({ error: 'Organization administrator access is required.' });
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'This voice feature is not enabled for your company.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

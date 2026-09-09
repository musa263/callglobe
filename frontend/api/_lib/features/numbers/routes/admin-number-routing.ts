import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { readPbxConfig, savePbxConfig } from '../../organizations/pbx-config-store.js';
import { readExtensionDirectory } from '../../organizations/extension-store.js';
import { acquireTenantMutation } from '../../organizations/tenant-mutation.js';
import { requestOrganizationId, writeTenantScopeError } from '../../organizations/request-organization.js';
import { requireFeature } from '../../organizations/saas-access.js';
import { applyNumberRouting, numberRoutingSnapshot, NumberRoutingError } from '../number-routing.js';

const dependencies = { requireAdmin, readPbxConfig, savePbxConfig, readExtensionDirectory, acquireTenantMutation, requireFeature };
export function createNumberRoutingHandler(deps = dependencies) {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (allowMobile(req, res)) return;
    if (!['GET', 'PUT'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'PUT']);
    let release: (() => Promise<boolean>) | undefined;
    try {
      const access = await deps.requireAdmin(req);
      const config = await deps.readPbxConfig({ fresh: true });
      const organizationId = requestOrganizationId(req, access.session, config);
      if (req.body?.organizationId !== undefined && req.body.organizationId !== organizationId) throw new NumberRoutingError(409, 'The numbers belong to another workspace.');
      if (!config.organizations.some(item => item.id === organizationId && item.status === 'active')) throw new NumberRoutingError(403, 'Organization inactive.');
      await deps.requireFeature({ ...access.session, organizationId }, 'phoneNumbers', config);
      res.setHeader('Cache-Control', 'no-store');
      // Serialize with user deletion so the destination cannot disappear during assignment.
      if (req.method === 'PUT') release = await deps.acquireTenantMutation(organizationId);
      const directory = await deps.readExtensionDirectory();
      if (!directory) throw new NumberRoutingError(503, 'User directory unavailable. Please retry.');
      if (req.method === 'GET') return res.status(200).json(numberRoutingSnapshot(config, organizationId, directory));
      const next = await deps.savePbxConfig(current => applyNumberRouting(current, organizationId, directory, req.body || {}));
      return res.status(200).json(numberRoutingSnapshot(next, organizationId, directory));
    } catch (error) {
      if (writeTenantScopeError(res, error) || writeAuthError(res, error)) return;
      if (error instanceof NumberRoutingError) return res.status(error.status).json({ error: error.message });
      if (error instanceof Error && /Tenant mutation in progress/.test(error.message)) return res.status(409).json({ error: 'Another administrator is updating this workspace. Retry shortly.' });
      if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/.test(error.message)) return res.status(403).json({ error: 'Number management is not enabled for this company.' });
      return res.status(500).json({ error: publicError(error) });
    } finally {
      if (release) await release().catch(() => console.error('Number routing mutation lease release failed'));
    }
  };
}
export default createNumberRoutingHandler();

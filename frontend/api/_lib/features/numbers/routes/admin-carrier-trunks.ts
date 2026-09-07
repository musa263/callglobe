import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { pbxForOrganization, readPbxConfig } from '../../organizations/pbx-config-store.js';
import { requestOrganizationId, writeTenantScopeError } from '../../organizations/request-organization.js';
import { requireFeature } from '../../organizations/saas-access.js';
import { listExtensions } from '../../organizations/pbx.js';
import { carrierTrunks, CarrierTrunkError, normalizeCarrierTrunk } from '../carrier-trunk-store.js';

export function createCarrierTrunksHandler(deps = { requireAdmin, readPbxConfig, requireFeature, listExtensions, store: carrierTrunks }) {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (allowMobile(req, res)) return;
    if (!['GET', 'PUT'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'PUT']);
    try {
      const access = await deps.requireAdmin(req), config = await deps.readPbxConfig();
      const organizationId = requestOrganizationId(req, access.session, config);
      if (!config.organizations.some(item => item.id === organizationId && item.status === 'active')) return res.status(403).json({ error: 'Organization inactive.' });
      await deps.requireFeature({ ...access.session, organizationId }, 'sipTrunks', config);
      res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'GET') return res.status(200).json({ trunks: await deps.store.list(organizationId) });
      if (req.body?.organizationId && req.body.organizationId !== organizationId) throw new CarrierTrunkError(409, 'This trunk belongs to another workspace.');
      const draft = normalizeCarrierTrunk(req.body || {}, organizationId);
      const pbx = pbxForOrganization(config, organizationId);
      const extensions = draft.numbers.some(item => item.destinationType === 'extension') ? await deps.listExtensions(organizationId) : [];
      for (const number of draft.numbers) {
        const targets = number.destinationType === 'extension' ? extensions
          : number.destinationType === 'ring_group' ? pbx.callHandling.ringGroups
          : number.destinationType === 'queue' ? pbx.callHandling.queues
          : number.destinationType === 'ivr' ? pbx.callHandling.ivrs : null;
        if (targets && !targets.some(item => item.id === number.destinationId)) throw new CarrierTrunkError(400, 'Choose a destination from this company.');
      }
      return res.status(200).json({ trunk: await deps.store.save(organizationId, { ...draft, revision: req.body.revision }) });
    } catch (error) {
      if (writeTenantScopeError(res, error) || writeAuthError(res, error)) return;
      if (error instanceof CarrierTrunkError) return res.status(error.status).json({ error: error.message });
      if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/.test(error.message)) return res.status(403).json({ error: 'SIP trunk management is not enabled for this company.' });
      return res.status(500).json({ error: publicError(error) });
    }
  };
}
export default createCarrierTrunksHandler();

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed } from '../http.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { effectiveEntitlements, readSaasState } from '../saas-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const session = await requireSession(req);
    const isOwner = session.sub === 'vocivo-owner';
    const config = await readPbxConfig();
    const organization = session.organizationId ? config.organizations.find((item) => item.id === session.organizationId) : undefined;
    const access = organization ? effectiveEntitlements(await readSaasState(config), organization.id, organization.accountType) : undefined;
    return res.status(200).json({
      profile: {
        id: session.sub,
        email: session.email,
        full_name: isOwner ? process.env.APP_ADMIN_NAME || 'Vocivo Superadmin' : session.name || `Extension ${session.extension || ''}`,
        currency: 'USD',
        extension: session.extension,
        organization_id: session.organizationId,
        role: session.role,
        account_type: isOwner ? 'platform' : organization?.accountType || session.accountType || 'business',
        organization_name: isOwner ? 'Vocivo' : organization?.name,
        organization_owner: organization?.ownerDisplayName,
        admin_only: Boolean(session.accountId && !session.extensionId) || isOwner,
        force_password_change: Boolean(session.forcePasswordChange),
        entitlements: access?.features,
        subscription: access ? { plan: access.plan.name, status: access.subscription.status, renews_at: access.subscription.renewsAt } : undefined,
      },
    });
  } catch {
    return res.status(401).json({ error: 'Session expired.' });
  }
}

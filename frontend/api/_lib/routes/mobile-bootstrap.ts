import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../http.js';
import { listExtensions } from '../pbx.js';
import { assignedNumbersForOrganization } from '../phone-number-access.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { readUserProfile, readUserProfiles } from '../profile-store.js';
import { mobileRates } from '../rates.js';
import { accessForSession } from '../saas-access.js';
import { sessionOrganizationId } from '../tenancy.js';
import { readRetailRateDirectory, readTenantWallet } from '../wallet-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const session = await requireSession(req);
    if (session.sub === 'vocivo-owner') return res.status(403).json({ error: 'Platform administrators use the Vocivo web portal.' });
    const config = await readPbxConfig();
    const access = await accessForSession(session, config);
    if (access.superadmin === true) return res.status(403).json({ error: 'Platform administrators use the Vocivo web portal.' });
    const organizationId = sessionOrganizationId(session, config);
    const organization = access.organization;
    const canUseDirectory = organization.accountType === 'business' && organization.internalCallingEnabled && access.features.internalCalling;
    const canViewWallet = organization.accountType === 'individual' || ['company_owner', 'company_admin'].includes(session.role || '');
    const [extensions, storedProfile, wallet, rates] = await Promise.all([
      canUseDirectory ? listExtensions(organizationId) : Promise.resolve([]),
      readUserProfile(session.sub || ''),
      canViewWallet ? readTenantWallet(organizationId, access.subscription.currency) : Promise.resolve(null),
      readRetailRateDirectory(mobileRates),
    ]);
    const profiles = canUseDirectory
      ? await readUserProfiles(extensions.map((item) => `vocivo-extension:${item.id}`))
      : new Map();
    const directory = extensions.filter((item) => item.status === 'active').map(({ id, extension, name, department, role, sipUsername }) => {
      const stored = profiles.get(`vocivo-extension:${id}`);
      return { id, extension, name: stored?.fullName || name, department: stored?.department || department, role, sipUsername, photoUrl: stored?.photoUrl, jobTitle: stored?.jobTitle };
    });
    const assignedNumbers = assignedNumbersForOrganization(config, organizationId);
    const baseProfile = {
      id: session.sub || '',
      email: session.email || '',
      full_name: session.name || `Extension ${session.extension || ''}`,
      currency: access.subscription.currency,
      extension: session.extension,
      organization_id: organization.id,
      organization_name: organization.name,
      organization_owner: organization.ownerDisplayName,
      role: session.role,
      account_type: organization.accountType,
      admin_only: Boolean(session.accountId && !session.extensionId),
    };
    const profile = {
      ...baseProfile,
      ...(storedProfile ? {
        full_name: storedProfile.fullName || baseProfile.full_name,
        job_title: storedProfile.jobTitle,
        department: storedProfile.department,
        mobile: storedProfile.mobile,
        location: storedProfile.location,
        bio: storedProfile.bio,
        photo_url: storedProfile.photoUrl,
      } : {}),
    };
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({
      profile,
      account: { balance: wallet ? wallet.availableMinor / 100 : null, can_call: access.features.internalCalling || access.features.outboundCalling, currency: wallet?.currency || access.subscription.currency, rates },
      numbers: assignedNumbers,
      directory,
      calls: [],
      capabilities: access.features,
    });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && /Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'This company account is inactive.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

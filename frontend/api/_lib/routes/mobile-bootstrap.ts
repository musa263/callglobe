import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { callHistoryFromEvents } from '../call-history.js';
import { listCallEvents } from '../call-event-store.js';
import { allowMobile, methodNotAllowed, publicError, requiredEnv } from '../http.js';
import { listExtensions } from '../pbx.js';
import { listOwnedNumbers, listVerifiedNumbers } from '../phone-number-access.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { readUserProfile, readUserProfiles } from '../profile-store.js';
import { mobileRates } from '../rates.js';
import { accessForSession } from '../saas-access.js';
import { normalizeE164, sessionCanAccessNumber, sessionOrganizationId } from '../tenancy.js';

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
    const [extensions, storedProfile, events, owned, verified] = await Promise.all([
      canUseDirectory ? listExtensions(organizationId) : Promise.resolve([]),
      readUserProfile(session.sub || ''),
      listCallEvents(250, organizationId).catch(() => []),
      listOwnedNumbers().catch(() => []),
      listVerifiedNumbers().catch(() => []),
    ]);
    const profiles = canUseDirectory
      ? await readUserProfiles(extensions.map((item) => `vocivo-extension:${item.id}`))
      : new Map();
    const directory = extensions.filter((item) => item.status === 'active').map(({ id, extension, name, department, role, sipUsername }) => {
      const stored = profiles.get(`vocivo-extension:${id}`);
      return { id, extension, name: stored?.fullName || name, department: stored?.department || department, role, sipUsername, photoUrl: stored?.photoUrl, jobTitle: stored?.jobTitle };
    });
    const assignedOwned = owned.filter((number) => sessionCanAccessNumber(session, number.phone_number, config)).map((number) => {
      const normalized = normalizeE164(number.phone_number);
      const assignment = config.numberAssignments[normalized];
      return {
        id: number.id,
        phone_number: normalized,
        label: assignment?.label || number.connection_name || 'Vocivo number',
        country_code: number.country_iso_alpha2 || null,
        status: number.status || 'active',
        receives_calls: [requiredEnv('TELNYX_CONNECTION_ID'), requiredEnv('TELNYX_CALL_CONTROL_APP_ID')].includes(number.connection_id || ''),
        messaging_enabled: Boolean(number.messaging_profile_id),
        source: 'owned' as const,
      };
    });
    const assignedVerified = verified.filter((number) => sessionCanAccessNumber(session, number.phone_number, config)).map((number) => ({
      id: `verified-${number.phone_number}`,
      phone_number: normalizeE164(number.phone_number),
      label: config.numberAssignments[normalizeE164(number.phone_number)]?.label || 'Verified caller ID',
      country_code: null,
      status: 'active',
      receives_calls: false,
      messaging_enabled: false,
      source: 'verified' as const,
    }));
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
    const calls = callHistoryFromEvents(events, organizationId, 100, {
      extensionId: session.extensionId,
      extension: session.extension,
      directory: directory.map(({ id, extension, name, sipUsername }) => ({ id, extension, name, sipUsername })),
    });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({
      profile,
      account: { balance: null, can_call: access.features.internalCalling || access.features.outboundCalling, currency: access.subscription.currency, rates: mobileRates },
      numbers: [...assignedOwned, ...assignedVerified],
      directory,
      calls,
      capabilities: access.features,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && /Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'This company account is inactive.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { organizationSettingsFrom, pbxForOrganization, readPbxConfig, savePbxConfig } from '../pbx-config-store.js';
import { listExtensions } from '../pbx.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'PUT'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'PUT']);
  try {
    const access = await requireAdmin(req);
    let config;
    if (req.method === 'PUT') {
      const current = await readPbxConfig();
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      // Number routing, Business Voice and AI have dedicated endpoints. Ignoring
      // those fields here prevents a stale admin screen from undoing newer saves.
      const {
        version: _version,
        updatedAt: _updatedAt,
        numberAssignments: _numberAssignments,
        businessVoiceConfigs: _businessVoiceConfigs,
        organizationSettings: _organizationSettings,
        ai: _ai,
        ...editable
      } = body;
      const requestedOrganizationId = access.superadmin && typeof editable.activeOrganizationId === 'string'
        ? editable.activeOrganizationId
        : access.organizationId || current.activeOrganizationId;
      const organizationId = current.organizations.some((item) => item.id === requestedOrganizationId)
        || Array.isArray(editable.organizations) && editable.organizations.some((item: { id?: string }) => item.id === requestedOrganizationId)
        ? requestedOrganizationId
        : current.activeOrganizationId;
      const currentTenant = pbxForOrganization(current, access.superadmin && organizationId !== current.activeOrganizationId ? organizationId : access.organizationId || current.activeOrganizationId);
      if (editable.callHandling && (!access.superadmin || organizationId === current.activeOrganizationId)) {
        const extensionIds = new Set((await listExtensions(organizationId)).filter((item) => item.status === 'active').map((item) => item.id));
        const groups = [...(editable.callHandling.ringGroups || []), ...(editable.callHandling.queues || [])];
        const unknownMember = groups.flatMap((item: { members?: string[] }) => item.members || []).find((id: string) => !extensionIds.has(id));
        if (unknownMember) return res.status(400).json({ error: 'A call-handling route contains a removed or inactive extension. Refresh users and choose its members again.' });
        const invalidIvrExtension = (editable.callHandling.ivrs || []).flatMap((item: { options?: Record<string, string> }) => Object.values(item.options || {}))
          .find((target: string) => target.startsWith('extension:') && !extensionIds.has(target.slice('extension:'.length)));
        if (invalidIvrExtension) return res.status(400).json({ error: 'A voice menu points to a removed or inactive extension. Refresh users and choose its destination again.' });
      }
      if (!access.superadmin) {
        const organization = current.organizations.find((item) => item.id === organizationId);
        if (!organization) return res.status(403).json({ error: 'Your organization is not active.' });
        const protectedOrganization = Array.isArray(editable.organizations)
          ? editable.organizations.find((item: { id?: string }) => item.id === organizationId)
          : undefined;
        const safeOrganization = protectedOrganization ? {
          ...organization,
          name: typeof protectedOrganization.name === 'string' ? protectedOrganization.name : organization.name,
          ownerDisplayName: typeof protectedOrganization.ownerDisplayName === 'string' ? protectedOrganization.ownerDisplayName : organization.ownerDisplayName,
          ownerEmail: typeof protectedOrganization.ownerEmail === 'string' ? protectedOrganization.ownerEmail : organization.ownerEmail,
          internalCallingEnabled: organization.accountType === 'business' && protectedOrganization.internalCallingEnabled !== false,
        } : organization;
        const organizationExtensions = new Set((await listExtensions(organizationId)).map((item) => item.id));
        const scopedProfiles = Object.fromEntries(Object.entries(editable.userProfiles || {}).filter(([id]) => organizationExtensions.has(id))) as typeof current.userProfiles;
        const tenant = organizationSettingsFrom({
          ...currentTenant,
          ...editable,
          company: { ...currentTenant.company, ...(editable.company || {}), name: safeOrganization.name },
          ai: currentTenant.ai,
          platform: currentTenant.platform,
          organizations: currentTenant.organizations,
          organizationSettings: currentTenant.organizationSettings,
        });
        config = await savePbxConfig({
          organizations: current.organizations.map((item) => item.id === organizationId ? safeOrganization : item),
          activeOrganizationId: current.activeOrganizationId,
          platform: current.platform,
          organizationSettings: { ...current.organizationSettings, [organizationId]: tenant },
          userProfiles: { ...current.userProfiles, ...scopedProfiles },
        });
      } else {
        const switchingOrganization = organizationId !== current.activeOrganizationId;
        const organizations = Array.isArray(editable.organizations) ? editable.organizations : current.organizations;
        const tenant = organizationSettingsFrom({
          ...currentTenant,
          ...editable,
          company: { ...currentTenant.company, ...(editable.company || {}) },
          ai: currentTenant.ai,
          platform: currentTenant.platform,
          organizations: currentTenant.organizations,
          organizationSettings: currentTenant.organizationSettings,
        });
        config = await savePbxConfig({
          organizations,
          activeOrganizationId: organizationId,
          platform: editable.platform || current.platform,
          organizationSettings: switchingOrganization
            ? current.organizationSettings
            : { ...current.organizationSettings, [organizationId]: tenant },
          userProfiles: editable.userProfiles || current.userProfiles,
        });
      }
    } else {
      config = await readPbxConfig();
    }
    const organizationId = access.organizationId || config.activeOrganizationId;
    const organization = config.organizations.find((item) => item.id === organizationId);
    config = pbxForOrganization(config, organizationId);
    config.company = { ...config.company, name: organization?.name || config.company.name };
    if (!access.superadmin) {
      const extensionIds = new Set((await listExtensions(organizationId)).map((item) => item.id));
      config = {
        ...config,
        activeOrganizationId: organizationId,
        organizations: organization ? [organization] : [],
        numberAssignments: Object.fromEntries(Object.entries(config.numberAssignments).filter(([, assignment]) => assignment.organizationId === organizationId)),
        businessVoiceConfigs: config.businessVoiceConfigs[organizationId] ? { [organizationId]: config.businessVoiceConfigs[organizationId] } : {},
        userProfiles: Object.fromEntries(Object.entries(config.userProfiles).filter(([id]) => extensionIds.has(id))),
      };
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ config });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && error.message === 'Forbidden') return res.status(403).json({ error: 'Owner access is required.' });
    if (error instanceof Error && /call-handling|Ring group|Queue|Voice menu|phone number points|Office hours|office-hours|holiday|user|forwarding/i.test(error.message)) return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}

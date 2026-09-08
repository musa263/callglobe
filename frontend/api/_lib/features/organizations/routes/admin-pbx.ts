import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { requireAdmin } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { organizationSettingsFrom, PbxConfigConflictError, pbxForOrganization, readPbxConfig, savePbxConfig, type PbxConfig } from '../pbx-config-store.js';
import { listExtensions } from '../pbx.js';
import { requireFeature } from '../saas-access.js';
import { requestOrganizationId, TenantScopeError, writeTenantScopeError } from '../request-organization.js';
import { validateOutgoingLine } from '../../numbers/dialing-defaults.js';

function workspaceVersion(config: PbxConfig, organizationId: string, extensionIds: Set<string>) {
  const { ai: _ai, ...settings } = organizationSettingsFrom(pbxForOrganization(config, organizationId));
  return createHash('sha256').update(JSON.stringify({
    settings,
    organization: config.organizations.find((item) => item.id === organizationId),
    profiles: Object.entries(config.userProfiles).filter(([id]) => extensionIds.has(id)).sort(([a], [b]) => a.localeCompare(b)),
  })).digest('hex');
}

export function createAdminPbxHandler(dependencies = { requireAdmin, readPbxConfig, savePbxConfig, listExtensions, requireFeature }) {
  const { requireAdmin, readPbxConfig, savePbxConfig, listExtensions, requireFeature } = dependencies;
  return async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'PUT'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'PUT']);
  try {
    const access = await requireAdmin(req);
    const current = await readPbxConfig();
    const organizationId = requestOrganizationId(req, access.session, current, { allowInitialRead: true });
    const extensionIds = new Set((await listExtensions(organizationId)).map((item) => item.id));
    let config = current;
    if (req.method === 'PUT') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (body.activeOrganizationId !== undefined && body.activeOrganizationId !== organizationId) {
        throw new TenantScopeError(409, 'The form belongs to another workspace. Reload it before saving.');
      }
      if (body.workspaceVersion !== workspaceVersion(current, organizationId, extensionIds)) throw new PbxConfigConflictError();
      // Number routing, Business Voice and AI have dedicated endpoints. Ignoring
      // those fields here prevents a stale admin screen from undoing newer saves.
      const {
        version: _version,
        updatedAt: _updatedAt,
        workspaceVersion: _workspaceVersion,
        numberAssignments: _numberAssignments,
        businessVoiceConfigs: _businessVoiceConfigs,
        organizationSettings: _organizationSettings,
        ai: _ai,
        ...editable
      } = body;
      const currentTenant = pbxForOrganization(current, organizationId);
      for (const [id, profile] of Object.entries(editable.userProfiles || {}) as Array<[string, { outboundCallerId?: unknown }]>) {
        if (extensionIds.has(id) && profile?.outboundCallerId !== current.userProfiles[id]?.outboundCallerId) {
          validateOutgoingLine(current, organizationId, profile?.outboundCallerId);
        }
      }
      if (editable.company?.defaultCallerId !== undefined && editable.company.defaultCallerId !== currentTenant.company.defaultCallerId) {
        validateOutgoingLine(current, organizationId, editable.company.defaultCallerId);
      }
      if (!access.superadmin) {
        if (editable.outboundRules) await requireFeature(access.session, 'outboundCalling', current);
        if (editable.callHandling?.ringGroups?.length || editable.callHandling?.queues?.length) await requireFeature(access.session, 'queues', current);
        if (editable.callHandling?.ivrs?.length) await requireFeature(access.session, 'ivr', current);
        if (editable.system?.recordingEnabled) await requireFeature(access.session, 'callRecording', current);
      }
      if (editable.callHandling) {
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
          internalCallingEnabled: organization.internalCallingEnabled,
        } : organization;
        const scopedProfiles = Object.fromEntries(Object.entries(editable.userProfiles || {}).filter(([id]) => extensionIds.has(id))) as typeof current.userProfiles;
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
        }, { expectedUpdatedAt: current.updatedAt });
      } else {
        const organizationPatch = Array.isArray(editable.organizations)
          ? editable.organizations.find((item: { id?: string }) => item.id === organizationId) : undefined;
        const organizations = current.organizations.map((item) => item.id === organizationId && organizationPatch
          ? { ...item, ...organizationPatch, id: organizationId } : item);
        const profiles = Object.fromEntries(Object.entries(editable.userProfiles || {}).filter(([id]) => extensionIds.has(id))) as typeof current.userProfiles;
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
          activeOrganizationId: current.activeOrganizationId,
          platform: current.platform,
          organizationSettings: { ...current.organizationSettings, [organizationId]: tenant },
          userProfiles: { ...current.userProfiles, ...profiles },
        }, { expectedUpdatedAt: current.updatedAt });
      }
    }
    const revision = workspaceVersion(config, organizationId, extensionIds);
    const organization = config.organizations.find((item) => item.id === organizationId);
    config = pbxForOrganization(config, organizationId);
    config.company = { ...config.company, name: organization?.name || config.company.name };
    if (!access.superadmin) {
      // organizationSettings holds every tenant's phone system — their
      // greetings, voice menus, ring groups, outbound rules and receptionist
      // instructions — and platform holds which carrier is behind Vocivo,
      // which the console itself says is superadmin-only. Both rode along in
      // this response to any company administrator who opened their settings.
      const { organizationSettings: _settings, platform: _platform, legacyPrimaryOrganizationId: _legacy, ...visible } = config;
      config = {
        ...visible,
        activeOrganizationId: organizationId,
        organizations: organization ? [organization] : [],
        numberAssignments: Object.fromEntries(Object.entries(config.numberAssignments as PbxConfig['numberAssignments']).filter(([, assignment]) => assignment.organizationId === organizationId)),
        businessVoiceConfigs: config.businessVoiceConfigs[organizationId] ? { [organizationId]: config.businessVoiceConfigs[organizationId] } : {},
        userProfiles: Object.fromEntries(Object.entries(config.userProfiles).filter(([id]) => extensionIds.has(id))),
      } as PbxConfig;
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ config: { ...config, workspaceVersion: revision } });
  } catch (error) {
    if (writeTenantScopeError(res, error)) return;
    if (error instanceof PbxConfigConflictError) return res.status(409).json({ error: error.message });
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && error.message === 'Forbidden') return res.status(403).json({ error: 'Owner access is required.' });
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'This phone-system capability is not enabled for your company.' });
    if (error instanceof Error && /call-handling|Ring group|Queue|Voice menu|phone number points|Office hours|office-hours|holiday|user|forwarding/i.test(error.message)) return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
  };
}

export default createAdminPbxHandler();

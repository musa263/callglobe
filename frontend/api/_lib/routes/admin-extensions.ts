import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { createExtension, deleteExtension, listExtensions, updateExtension } from '../pbx.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { accessForSession } from '../saas-access.js';
import { findTenantAdminForExtension, readSaasState, removeTenantAdminForExtension, saveTenantAdmin } from '../saas-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE']);
  try {
    const access = await requireAdmin(req);
    const config = await readPbxConfig();
    const requestedOrganizationId = typeof req.body?.organizationId === 'string' ? req.body.organizationId : typeof req.query.organizationId === 'string' ? req.query.organizationId : '';
    const organizationId = access.superadmin ? requestedOrganizationId || config.activeOrganizationId : access.organizationId || '';
    const organization = config.organizations.find((item) => item.id === organizationId);
    if (!organization) return res.status(404).json({ error: 'Organization not found.' });
    const subscriptionAccess = await accessForSession(access.session, config);
    if (req.method === 'GET') {
      const extensions = await listExtensions(organization?.id);
      const assignedInRange = organization ? extensions.filter((item) => Number(item.extension) >= organization.extensionStart && Number(item.extension) <= organization.extensionEnd).length : 0;
      return res.status(200).json({
        extensions,
        organization,
        capacity: organization ? { used: assignedInRange, total: organization.extensionEnd - organization.extensionStart + 1 } : { used: 0, total: 0 },
      });
    }
    if (req.method === 'POST') {
      const requestedRole = req.body?.role;
      if (!access.superadmin && ['company_owner', 'company_admin'].includes(requestedRole) && access.session.role !== 'company_owner') return res.status(403).json({ error: 'Only the company owner can grant administrator access.' });
      if (['company_owner', 'company_admin'].includes(requestedRole)) {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
        const password = typeof req.body?.loginPassword === 'string' ? req.body.loginPassword : '';
        if (!email) return res.status(400).json({ error: 'Company administrators require an email address.' });
        if (password.length < 10 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) return res.status(400).json({ error: 'Set a temporary password with 10 characters, upper and lowercase letters, and a number.' });
        const state = await readSaasState(config);
        if (state.tenantAdmins.some((account) => account.email === email.toLowerCase())) return res.status(409).json({ error: 'This email already belongs to a company administrator.' });
      }
      if (subscriptionAccess.superadmin === false) {
        const used = (await listExtensions(organizationId)).filter((item) => item.status === 'active').length;
        if (used >= subscriptionAccess.plan.limits.seats) return res.status(409).json({ error: `Your ${subscriptionAccess.plan.name} plan includes ${subscriptionAccess.plan.limits.seats} users. Ask Vocivo to increase the subscription capacity.` });
      }
      const created = await createExtension({ ...(req.body ?? {}), organizationId });
      if (created.extension && ['company_owner', 'company_admin'].includes(created.extension.role)) {
        const password = typeof req.body?.loginPassword === 'string' ? req.body.loginPassword : '';
        if (!created.extension.email) return res.status(400).json({ error: 'Company administrators require an email address.' });
        try {
          await saveTenantAdmin({ organizationId, email: created.extension.email, name: created.extension.name, role: created.extension.role as 'company_owner' | 'company_admin', password, extensionId: created.extension.id, extension: created.extension.extension, status: 'active', forcePasswordChange: true }, config);
        } catch (adminError) {
          await deleteExtension(created.extension.id).catch(() => undefined);
          throw adminError;
        }
      }
      return res.status(201).json(created);
    }
    const id = typeof req.body?.id === 'string' ? req.body.id : typeof req.query.id === 'string' ? req.query.id : '';
    if (!id) return res.status(400).json({ error: 'Extension ID is required.' });
    const existing = (await listExtensions(organizationId)).find((item) => item.id === id);
    if (!existing) return res.status(404).json({ error: 'Extension not found in this organization.' });
    if (req.method === 'PATCH') {
      const requestedRole = req.body?.role;
      const state = await readSaasState(config);
      const linkedAdmin = state.tenantAdmins.find((account) => account.extensionId === id);
      if (!access.superadmin && ['company_owner', 'company_admin'].includes(requestedRole) && access.session.role !== 'company_owner') return res.status(403).json({ error: 'Only the company owner can grant administrator access.' });
      if (['company_owner', 'company_admin'].includes(requestedRole)) {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim() : existing.email;
        const password = typeof req.body?.loginPassword === 'string' ? req.body.loginPassword : '';
        if (!email) return res.status(400).json({ error: 'Company administrators require an email address.' });
        if (!linkedAdmin && (password.length < 10 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password))) return res.status(400).json({ error: 'Set a temporary password to enable this administrator login.' });
        if (password && (password.length < 10 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password))) return res.status(400).json({ error: 'Use 10 characters with upper and lowercase letters and a number.' });
        const duplicate = state.tenantAdmins.find((account) => account.email === email.toLowerCase() && account.id !== linkedAdmin?.id);
        if (duplicate) return res.status(409).json({ error: 'This email already belongs to another company administrator.' });
      } else {
        const remainingAdmins = state.tenantAdmins.filter((account) => account.organizationId === organizationId && account.status === 'active' && account.id !== linkedAdmin?.id);
        if (linkedAdmin && organization.accountType === 'business' && !remainingAdmins.length) return res.status(409).json({ error: 'Assign another company administrator before removing this administrator role.' });
      }
      const extension = await updateExtension(id, { ...(req.body ?? {}), organizationId });
      if (extension && ['company_owner', 'company_admin'].includes(extension.role)) {
        if (!extension.email) return res.status(400).json({ error: 'Company administrators require an email address.' });
        const existingAdmin = await findTenantAdminForExtension(id, config);
        const password = typeof req.body?.loginPassword === 'string' ? req.body.loginPassword : '';
        if (!existingAdmin && !password) return res.status(400).json({ error: 'Set a temporary password to enable this administrator login.' });
        await saveTenantAdmin({ ...existingAdmin, organizationId, email: extension.email, name: extension.name, role: extension.role as 'company_owner' | 'company_admin', password: password || undefined, extensionId: extension.id, extension: extension.extension, status: 'active', forcePasswordChange: password ? true : existingAdmin?.forcePasswordChange }, config);
      } else {
        await removeTenantAdminForExtension(id, config);
      }
      return res.status(200).json({ extension });
    }
    const state = await readSaasState(config);
    const linkedAdmin = state.tenantAdmins.find((account) => account.extensionId === id);
    const remainingAdmins = state.tenantAdmins.filter((account) => account.organizationId === organizationId && account.status === 'active' && account.id !== linkedAdmin?.id);
    if (linkedAdmin && organization.accountType === 'business' && !remainingAdmins.length) return res.status(409).json({ error: 'Assign another company administrator before deleting this user.' });
    await deleteExtension(id);
    await removeTenantAdminForExtension(id, config);
    return res.status(200).json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && error.message === 'Forbidden') return res.status(403).json({ error: 'Owner access is required.' });
    if (error instanceof Error && /Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'This company subscription is not active.' });
    if (error instanceof Error && /required|exists|not found|digits|extension|organization|range|slot/i.test(error.message)) return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}

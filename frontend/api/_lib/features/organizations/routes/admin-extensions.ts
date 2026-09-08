import { hasActiveAdministrator, isCompanyAdministrator, isCompanyAccountRole, validCompanyPassword } from '../../auth/company-account.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { mayAdministerAccount, mayGrantAdminAccess } from '../../auth/admin-account-access.js';
import { requireAdmin } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { normalizeRole, createExtension, deleteExtension, listExtensions, updateExtension } from '../pbx.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { accessForSession } from '../saas-access.js';
import { requestOrganizationId, TenantScopeError, writeTenantScopeError } from '../request-organization.js';
import {
  findTenantAdminByEmail, findTenantAdminForExtension, readTenantSaasState,
  removeTenantAdminForExtension, saveTenantAdmin,
} from '../saas-store.js';

const dependencies = { requireAdmin, readPbxConfig, accessForSession, listExtensions, createExtension, updateExtension, deleteExtension,
  findTenantAdminByEmail, findTenantAdminForExtension, readTenantSaasState, removeTenantAdminForExtension, saveTenantAdmin };
export function createAdminExtensionsHandler(deps = dependencies) {
  const { requireAdmin, readPbxConfig, accessForSession, listExtensions, createExtension, updateExtension, deleteExtension,
    findTenantAdminByEmail, findTenantAdminForExtension, readTenantSaasState, removeTenantAdminForExtension, saveTenantAdmin } = deps;
  return async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE']);
  try {
    const access = await requireAdmin(req);
    const actor = { superadmin: access.superadmin, role: access.session.role, extensionId: access.session.extensionId };
    const config = await readPbxConfig();
    const organizationId = requestOrganizationId(req, access.session, config);
    if (req.body?.organizationId !== undefined && req.body.organizationId !== organizationId) {
      throw new TenantScopeError(409, 'The user belongs to another workspace. Reload before saving.');
    }
    const organization = config.organizations.find((item) => item.id === organizationId);
    if (!organization || organization.status !== 'active') return res.status(404).json({ error: 'Organization not found.' });
    const subscriptionAccess = await accessForSession(access.session, config);
    if (req.method === 'GET') {
      const extensions = await listExtensions(organization?.id);
      const accounts = (await readTenantSaasState(organizationId, config)).tenantAdmins;
      const assignedInRange = organization ? extensions.filter((item) => Number(item.extension) >= organization.extensionStart && Number(item.extension) <= organization.extensionEnd).length : 0;
      return res.status(200).json({
        extensions: extensions.map(item => ({ ...item, webLoginEnabled: accounts.some(account => account.extensionId === item.id && account.status === 'active') })),
        organization,
        capacity: organization ? { used: assignedInRange, total: organization.extensionEnd - organization.extensionStart + 1 } : { used: 0, total: 0 },
      });
    }
    if (req.method === 'POST') {
      // Normalised first: the store accepts the aliases "owner" and "admin"
      // and saves them as company_owner / company_admin, but the guard below
      // only recognised the canonical names — so a company_admin sending
      // role: "owner" walked past it and minted an owner login.
      const requestedRole = normalizeRole(req.body?.role ?? 'user');
      if (!mayGrantAdminAccess(actor, requestedRole)) return res.status(403).json({ error: 'Only the company owner can grant administrator access.' });
      if (organization?.accountType === 'business') {
        if (!isCompanyAccountRole(requestedRole)) return res.status(400).json({ error: 'Choose a company user role.' });
        const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
        const password = typeof req.body?.loginPassword === 'string' ? req.body.loginPassword : '';
        if (!/^\S+@\S+\.\S+$/.test(email) || email.toLowerCase() === process.env.APP_ADMIN_EMAIL?.trim().toLowerCase()) return res.status(400).json({ error: 'Web sign-in requires a valid company user email address.' });
        if (!validCompanyPassword(password)) return res.status(400).json({ error: 'Set a temporary password with 10 characters, upper and lowercase letters, and a number.' });
        if (await findTenantAdminByEmail(email, config)) return res.status(409).json({ error: 'This email already belongs to a company account.' });
      }
      if (subscriptionAccess.superadmin === false) {
        const used = (await listExtensions(organizationId)).filter((item) => item.status === 'active').length;
        if (used >= subscriptionAccess.plan.limits.seats) return res.status(409).json({ error: `Your ${subscriptionAccess.plan.name} plan includes ${subscriptionAccess.plan.limits.seats} users. Ask Vocivo to increase the subscription capacity.` });
      }
      const created = await createExtension({ ...(req.body ?? {}), organizationId });
      if (created.extension && organization?.accountType === 'business' && isCompanyAccountRole(created.extension.role)) {
        const password = typeof req.body?.loginPassword === 'string' ? req.body.loginPassword : '';
        if (!created.extension.email) return res.status(400).json({ error: 'Web sign-in requires a valid company user email address.' });
        try {
          await saveTenantAdmin({ organizationId, email: created.extension.email, name: created.extension.name, role: created.extension.role, password, extensionId: created.extension.id, extension: created.extension.extension, status: created.extension.status === 'active' ? 'active' : 'suspended', forcePasswordChange: true }, config);
        } catch (adminError) {
          try { await deleteExtension(created.extension.id, organizationId); } catch { console.error('Company user creation cleanup failed; review the incomplete user.'); }
          throw adminError;
        }
      }
      return res.status(201).json({ ...created, extension: { ...created.extension, webLoginEnabled: organization?.accountType === 'business' && created.extension?.status === 'active' } });
    }
    const id = typeof req.body?.id === 'string' ? req.body.id : typeof req.query.id === 'string' ? req.query.id : '';
    if (!id) return res.status(400).json({ error: 'Extension ID is required.' });
    const existing = (await listExtensions(organizationId)).find((item) => item.id === id);
    if (!existing) return res.status(404).json({ error: 'Extension not found in this organization.' });
    if (req.method === 'PATCH') {
      // Normalised first: the store accepts the aliases "owner" and "admin"
      // and saves them as company_owner / company_admin, but the guard below
      // only recognised the canonical names — so a company_admin sending
      // role: "owner" walked past it and minted an owner login.
      const requestedRole = normalizeRole(req.body?.role ?? existing.role);
      if (organization.accountType === 'business' && !isCompanyAccountRole(requestedRole)) return res.status(400).json({ error: 'Choose a company user role.' });
      const state = await readTenantSaasState(organizationId, config);
      const linkedAdmin = state.tenantAdmins.find((account) => account.extensionId === id);
      const nextStatus = req.body?.status ?? existing.status;
      if (linkedAdmin && isCompanyAdministrator(linkedAdmin.role) && (!isCompanyAdministrator(requestedRole) || nextStatus !== 'active') && !hasActiveAdministrator(state.tenantAdmins.filter(account => account.id !== linkedAdmin.id))) return res.status(409).json({ error: 'Assign another company administrator before removing this administrator role.' });
      if (requestedRole !== existing.role && !mayGrantAdminAccess(actor, requestedRole)) return res.status(403).json({ error: 'Only the company owner can grant administrator access.' });
      // The guard above asks what role the request is asking for, and a request
      // that asks for none passed it vacuously. A company administrator could
      // therefore PATCH the owner's extension with nothing but a loginPassword:
      // no role changed, so nothing fired, and the block further down saved
      // that password as the owner's login — the owner's account, taken by one
      // of their own administrators.
      if (!mayAdministerAccount(actor, existing)) return res.status(403).json({ error: 'Only the company owner can change another administrator\u2019s account.' });
      if (isCompanyAccountRole(requestedRole) && (linkedAdmin || isCompanyAdministrator(requestedRole) || req.body?.loginPassword)) {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim() : existing.email;
        const password = typeof req.body?.loginPassword === 'string' ? req.body.loginPassword : '';
        if (!/^\S+@\S+\.\S+$/.test(email) || email.toLowerCase() === process.env.APP_ADMIN_EMAIL?.trim().toLowerCase()) return res.status(400).json({ error: 'Web sign-in requires a valid company user email address.' });
        if (!linkedAdmin && !validCompanyPassword(password)) return res.status(400).json({ error: 'Set a temporary password to enable this web login.' });
        if (password && !validCompanyPassword(password)) return res.status(400).json({ error: 'Use 10 characters with upper and lowercase letters and a number.' });
        const duplicate = await findTenantAdminByEmail(email, config);
        if (duplicate && duplicate.id !== linkedAdmin?.id) return res.status(409).json({ error: 'This email already belongs to another company account.' });
      } else {
        const remainingAdmins = state.tenantAdmins.filter((account) => account.organizationId === organizationId && account.status === 'active' && isCompanyAdministrator(account.role) && account.id !== linkedAdmin?.id);
        if (linkedAdmin && isCompanyAdministrator(linkedAdmin.role) && organization.accountType === 'business' && !remainingAdmins.length) return res.status(409).json({ error: 'Assign another company administrator before removing this administrator role.' });
      }
      const extension = await updateExtension(id, { ...(req.body ?? {}), organizationId }, organizationId);
      if (extension && isCompanyAccountRole(extension.role) && (linkedAdmin || isCompanyAdministrator(extension.role) || req.body?.loginPassword)) {
        if (!extension.email) return res.status(400).json({ error: 'Web sign-in requires a valid company user email address.' });
        const existingAdmin = await findTenantAdminForExtension(id, organizationId, config);
        const password = typeof req.body?.loginPassword === 'string' ? req.body.loginPassword : '';
        if (!existingAdmin && !password) return res.status(400).json({ error: 'Set a temporary password to enable this web login.' });
        await saveTenantAdmin({ ...existingAdmin, organizationId, email: extension.email, name: extension.name, role: extension.role, password: password || undefined, extensionId: extension.id, extension: extension.extension, status: extension.status === 'active' ? 'active' : 'suspended', forcePasswordChange: password ? true : existingAdmin?.forcePasswordChange }, config);
      } else {
        await removeTenantAdminForExtension(id, organizationId, config);
      }
      return res.status(200).json({ extension });
    }
    // Deleting an administrator takes the same authority as editing one, or an
    // administrator simply removes the owner instead.
    if (!mayAdministerAccount(actor, existing)) return res.status(403).json({ error: 'Only the company owner can remove another administrator\u2019s account.' });
    const state = await readTenantSaasState(organizationId, config);
    const linkedAdmin = state.tenantAdmins.find((account) => account.extensionId === id);
    const remainingAdmins = state.tenantAdmins.filter((account) => account.organizationId === organizationId && account.status === 'active' && isCompanyAdministrator(account.role) && account.id !== linkedAdmin?.id);
    if (linkedAdmin && isCompanyAdministrator(linkedAdmin.role) && organization.accountType === 'business' && !remainingAdmins.length) return res.status(409).json({ error: 'Assign another company administrator before deleting this user.' });
    await deleteExtension(id, organizationId);
    await removeTenantAdminForExtension(id, organizationId, config);
    return res.status(200).json({ success: true });
  } catch (error) {
    if (writeTenantScopeError(res, error)) return;
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && error.message === 'Forbidden') return res.status(403).json({ error: 'Owner access is required.' });
    if (error instanceof Error && /Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'This company subscription is not active.' });
    if (error instanceof Error && /required|exists|not found|digits|extension|organization|range|slot/i.test(error.message)) return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}

}
export default createAdminExtensionsHandler();

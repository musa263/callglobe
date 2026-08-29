import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { createSession, createTenantAdminSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, requiredEnv } from '../http.js';
import { readPasswordHash } from '../number-config.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { authenticateTenantAdmin, effectiveEntitlements, readTenantSaasState } from '../saas-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const expectedEmail = requiredEnv('APP_ADMIN_EMAIL').trim().toLowerCase();
    if (email === expectedEmail) {
      const passwordHash = await readPasswordHash().catch(() => requiredEnv('APP_PASSWORD_HASH'));
      const valid = password.length >= 8 && await bcrypt.compare(password, passwordHash);
      if (!valid) return res.status(401).json({ error: 'Email or password is incorrect.' });
      const token = await createSession(email);
      return res.status(200).json({
        token,
        profile: {
          id: 'vocivo-owner', email, full_name: process.env.APP_ADMIN_NAME || 'Vocivo Superadmin', currency: 'USD',
          role: 'superadmin', account_type: 'platform', organization_name: 'Vocivo', admin_only: true,
        },
      });
    }

    const config = await readPbxConfig();
    const account = password.length >= 8 ? await authenticateTenantAdmin(email, password, config) : null;
    const organization = account ? config.organizations.find((item) => item.id === account.organizationId && item.status === 'active') : undefined;
    if (!account || !organization) return res.status(401).json({ error: 'Email or password is incorrect.' });
    const access = effectiveEntitlements(await readTenantSaasState(organization.id, config), organization.id, organization.accountType);
    if (!access.serviceActive) return res.status(403).json({ error: 'This company subscription is not active. Contact Vocivo support.' });
    const token = await createTenantAdminSession(account);
    return res.status(200).json({
      token,
      profile: {
        id: account.id, email: account.email, full_name: account.name, currency: access.subscription.currency,
        role: account.role, account_type: organization.accountType, organization_id: organization.id,
        organization_name: organization.name, organization_owner: organization.ownerDisplayName,
        extension: account.extension, admin_only: !account.extensionId,
        force_password_change: account.forcePasswordChange, entitlements: access.features,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: publicError(error) });
  }
}

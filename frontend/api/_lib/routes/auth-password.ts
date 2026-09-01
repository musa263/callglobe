import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession, createTenantAdminSession, createSession, invalidateOwnerSessions } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../http.js';
import { changePassword } from '../number-config.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { activeTenantAdmin, changeTenantAdminPassword } from '../saas-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const session = await requireSession(req);
    const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
    if (newPassword.length < 10 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) return res.status(400).json({ error: 'Use at least 10 characters with upper and lowercase letters and a number.' });
    const changed = session.sub === 'vocivo-owner'
      ? await changePassword(currentPassword, newPassword)
      : session.accountId
        ? await changeTenantAdminPassword(session.accountId, session.organizationId || '', currentPassword, newPassword, await readPbxConfig())
        : false;
    if (!changed) return res.status(400).json({ error: 'Current password is incorrect.' });
    // Revoke existing owner tokens before minting the replacement so its iat
    // is not older than the invalidation marker.
    if (session.sub === 'vocivo-owner') await invalidateOwnerSessions();
    const token = session.sub === 'vocivo-owner'
      ? await createSession(session.email || '')
      : session.accountId && session.organizationId
        ? await createTenantAdminSession((await activeTenantAdmin(session.accountId, session.organizationId))!)
        : undefined;
    return res.status(200).json({ success: true, ...(token ? { token } : {}) });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    return res.status(500).json({ error: publicError(error) });
  }
}

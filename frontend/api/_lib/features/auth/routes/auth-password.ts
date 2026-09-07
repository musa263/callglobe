import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession, createTenantAdminSession, createSession, invalidateOwnerSessions, setSessionCookies } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { changePassword } from '../owner-password.js';
import { readPbxConfig } from '../../organizations/pbx-config-store.js';
import { activeTenantAdmin, changeTenantAdminPassword } from '../../organizations/saas-store.js';

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
    if (token) setSessionCookies(res, token, session.sub === 'vocivo-owner' ? 60 * 60 * 24 * 30 : 60 * 60 * 12);
    return res.status(200).json({ success: true, ...(token ? { token } : {}) });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    return res.status(500).json({ error: publicError(error) });
  }
}

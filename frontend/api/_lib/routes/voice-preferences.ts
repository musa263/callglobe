import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../http.js';
import { applyCallPreferences, callPreferencesFrom } from '../call-preferences.js';
import { getExtension } from '../pbx.js';
import { PbxConfigConflictError, readPbxConfig, savePbxConfig, type PbxConfig } from '../pbx-config-store.js';
import { sessionOrganizationId } from '../tenancy.js';

/**
 * A person's own call handling: voicemail, ring time, availability, a second
 * number, and where a call goes when they cannot be reached. Their own
 * extension only — the organisation's and everyone else's stay with the
 * administrator on /api/admin/pbx.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'PUT'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'PUT']);
  try {
    const session = await requireSession(req);
    if (!session.extensionId) return res.status(403).json({ error: 'A calling extension is required.' });
    const config = await readPbxConfig();
    const organizationId = sessionOrganizationId(session, config);
    const extension = await getExtension(session.extensionId, organizationId).catch(() => null);
    if (!extension || extension.organizationId !== organizationId) return res.status(403).json({ error: 'This extension belongs to another organization.' });
    const officeHours = config.organizationSettings[organizationId]?.officeHours || config.officeHours;
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ preferences: callPreferencesFrom(config.userProfiles[extension.id]), officeHours: { timezone: officeHours.timezone } });
    }
    const next = applyCallPreferences(config.userProfiles[extension.id], req.body);
    const saved: PbxConfig = await savePbxConfig((current) => ({
      userProfiles: { ...current.userProfiles, [extension.id]: { ...(current.userProfiles[extension.id] || next), ...next } },
    }));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ preferences: callPreferencesFrom(saved.userProfiles[extension.id]), officeHours: { timezone: officeHours.timezone } });
  } catch (error) {
    if (error instanceof PbxConfigConflictError) return res.status(409).json({ error: error.message });
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && /Ring time|Forwarding destinations|Choose "Always/.test(error.message)) return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}

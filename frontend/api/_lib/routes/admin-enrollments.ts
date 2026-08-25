import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createEnrollmentToken, requireAdmin } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, requiredEnv } from '../http.js';
import { getExtension } from '../pbx.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const access = await requireAdmin(req);
    const extensionId = typeof req.body?.extensionId === 'string' ? req.body.extensionId : '';
    if (!extensionId) return res.status(400).json({ error: 'Extension ID is required.' });
    const extension = await getExtension(extensionId);
    if (!access.superadmin && extension.organizationId !== access.organizationId) return res.status(403).json({ error: 'This extension belongs to another organization.' });
    const token = await createEnrollmentToken(extensionId);
    const origin = requiredEnv('VITE_APP_URL').replace(/\/+$/, '');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(201).json({
      extension: { id: extension.id, extension: extension.extension, name: extension.name },
      provisioningUri: `${origin}/enroll.html?token=${encodeURIComponent(token)}`,
      appUri: `vocivo://enroll?token=${encodeURIComponent(token)}`,
      expiresInSeconds: 600,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && error.message === 'Forbidden') return res.status(403).json({ error: 'Owner access is required.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

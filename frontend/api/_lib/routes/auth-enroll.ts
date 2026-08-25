import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createExtensionSession, verifyEnrollmentToken } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { getExtension } from '../pbx.js';
import { consumeEnrollment } from '../enrollment-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const enrollmentToken = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!enrollmentToken) return res.status(400).json({ error: 'Enrollment code is required.' });
    const { extensionId, jti } = await verifyEnrollmentToken(enrollmentToken);
    const extension = await getExtension(extensionId);
    if (extension.status !== 'active') return res.status(403).json({ error: 'This extension is not active.' });
    await consumeEnrollment(jti);
    const token = await createExtensionSession({ id: extension.id, email: extension.email, name: extension.name, role: extension.role, extension: extension.extension, organizationId: extension.organizationId });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ token, profile: { id: extension.id, email: extension.email, full_name: extension.name, currency: 'USD', extension: extension.extension, role: extension.role, organization_id: extension.organizationId } });
  } catch (error) {
    if (error instanceof Error && /expired|enrollment|extension|already been used/i.test(error.message)) return res.status(400).json({ error: 'This enrollment QR code is invalid, expired, or has already been used.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

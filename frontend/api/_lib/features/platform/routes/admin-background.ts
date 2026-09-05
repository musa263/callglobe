import type { VercelRequest, VercelResponse } from '@vercel/node';
import { put } from '../../../shared/object-store.js';
import { requireAdmin } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { requireFeature } from '../../organizations/saas-access.js';

const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const access = await requireAdmin(req);
    await requireFeature(access.session, 'customBranding');
    const contentType = typeof req.body?.contentType === 'string' ? req.body.contentType : '';
    const base64 = typeof req.body?.base64 === 'string' ? req.body.base64 : '';
    if (!allowed.has(contentType) || !base64) return res.status(400).json({ error: 'Choose a PNG, JPG or WebP image.' });
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > 4_000_000) return res.status(400).json({ error: 'Background image must be smaller than 4 MB.' });
    const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    const scope = access.organizationId || 'platform';
    const blob = await put(`vocivo/branding/${scope}/background-${Date.now()}.${extension}`, bytes, { access: 'public', contentType, addRandomSuffix: true });
    return res.status(201).json({ url: blob.url });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'Custom branding is not enabled for this company.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireOwner } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { createExtension, deleteExtension, listExtensions, updateExtension } from '../pbx.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE']);
  try {
    await requireOwner(req);
    if (req.method === 'GET') return res.status(200).json({ extensions: await listExtensions() });
    if (req.method === 'POST') return res.status(201).json(await createExtension(req.body ?? {}));
    const id = typeof req.body?.id === 'string' ? req.body.id : typeof req.query.id === 'string' ? req.query.id : '';
    if (!id) return res.status(400).json({ error: 'Extension ID is required.' });
    if (req.method === 'PATCH') return res.status(200).json({ extension: await updateExtension(id, req.body ?? {}) });
    await deleteExtension(id);
    return res.status(200).json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && error.message === 'Forbidden') return res.status(403).json({ error: 'Owner access is required.' });
    if (error instanceof Error && /required|exists|not found|digits/i.test(error.message)) return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}

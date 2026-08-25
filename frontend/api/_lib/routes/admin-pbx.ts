import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireOwner } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { readPbxConfig, savePbxConfig } from '../pbx-config-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'PUT'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'PUT']);
  try {
    await requireOwner(req);
    const config = req.method === 'PUT' ? await savePbxConfig(req.body ?? {}) : await readPbxConfig();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ config });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && error.message === 'Forbidden') return res.status(403).json({ error: 'Owner access is required.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireOwner, requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { readBusinessVoiceConfig, saveBusinessVoiceConfig } from '../number-config.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'PUT'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'PUT']);
  try {
    if (req.method === 'PUT') await requireOwner(req); else await requireSession(req);
    const config = req.method === 'PUT' ? await saveBusinessVoiceConfig(req.body ?? {}) : await readBusinessVoiceConfig();
    return res.status(200).json({ config });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

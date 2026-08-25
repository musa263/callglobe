import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireOwner } from '../auth.js';
import { allowMobile, methodNotAllowed } from '../http.js';
import { telnyx } from '../telnyx.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    await requireOwner(req);
    const response = await telnyx('/call_events?page[size]=25', { signal: AbortSignal.timeout(5000) });
    const payload = await response.json() as { data?: unknown[]; meta?: unknown };
    res.setHeader('Cache-Control', 'private, max-age=15');
    return res.status(200).json({ events: payload.data || [], meta: payload.meta || {} });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    console.error('Call event reporting unavailable', error);
    return res.status(200).json({ events: [], meta: {}, unavailable: true });
  }
}

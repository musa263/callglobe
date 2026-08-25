import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowMobile } from './_lib/http.js';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  res.status(200).json({ ok: true, service: 'vocivo-api', time: new Date().toISOString() });
}

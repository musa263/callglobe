import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../_lib/auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../_lib/http.js';
import { mobileRates } from '../_lib/rates.js';
import { telnyx } from '../_lib/telnyx.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    await requireSession(req);
    const response = await telnyx('/balance');
    const payload = await response.json();
    return res.status(200).json({
      balance: Number(payload?.data?.available_credit ?? payload?.data?.balance ?? 0),
      currency: payload?.data?.currency ?? 'USD',
      pending: Number(payload?.data?.pending ?? 0),
      rates: mobileRates,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../_lib/auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../_lib/http.js';
import { mobileRates } from '../_lib/rates.js';
import { accessForSession } from '../_lib/saas-access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const session = await requireSession(req);
    if (session.sub === 'vocivo-owner') return res.status(200).json({ balance: null, can_call: false, currency: 'USD', pending: 0, rates: mobileRates });
    const access = await accessForSession(session);
    const canCall = access.superadmin || access.features.internalCalling || access.features.outboundCalling;
    return res.status(200).json({
      balance: null,
      can_call: canCall,
      currency: access.superadmin ? 'USD' : access.subscription.currency,
      pending: 0,
      rates: mobileRates,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && ['Organization inactive', 'Subscription inactive'].includes(error.message)) return res.status(403).json({ error: 'This company account is inactive.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

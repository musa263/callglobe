import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { mobileRates } from '../rates.js';
import { accessForSession } from '../../organizations/saas-access.js';
import { readRetailRateDirectory, readTenantWallet } from '../wallet-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const session = await requireSession(req);
    if (session.sub === 'vocivo-owner') return res.status(200).json({ balance: null, can_call: false, currency: 'USD', pending: 0, rates: mobileRates });
    const access = await accessForSession(session);
    if (access.superadmin === true) return res.status(200).json({ balance: null, can_call: false, currency: 'USD', pending: 0, rates: mobileRates });
    const canCall = access.features.internalCalling || access.features.outboundCalling;
    const [wallet, rates] = await Promise.all([
      readTenantWallet(access.organization.id, access.subscription.currency),
      readRetailRateDirectory(mobileRates),
    ]);
    return res.status(200).json({
      balance: wallet ? wallet.availableMinor / 100 : null,
      can_call: canCall,
      currency: wallet?.currency || access.subscription.currency,
      pending: wallet ? wallet.reservedMinor / 100 : 0,
      rates,
    });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && ['Organization inactive', 'Subscription inactive'].includes(error.message)) return res.status(403).json({ error: 'This company account is inactive.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../_lib/auth.js';
import { allowMobile, methodNotAllowed, publicError, requiredEnv } from '../_lib/http.js';
import { telnyx } from '../_lib/telnyx.js';

type TelnyxNumber = {
  id: string;
  phone_number: string;
  country_iso_alpha2?: string;
  status?: string;
  connection_id?: string | null;
  connection_name?: string | null;
  tags?: string[];
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    await requireSession(req);
    const connectionId = requiredEnv('TELNYX_CONNECTION_ID');
    const response = await telnyx('/phone_numbers?page[size]=250&filter[status]=active');
    const payload = await response.json() as { data?: TelnyxNumber[] };
    const numbers = (payload.data ?? []).map((number) => ({
      id: number.id,
      phone_number: number.phone_number,
      label: number.tags?.[0] || number.connection_name || number.phone_number,
      country_code: number.country_iso_alpha2 || null,
      status: number.status || 'active',
      receives_calls: number.connection_id === connectionId,
      source: 'owned',
    }));
    return res.status(200).json({ numbers });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

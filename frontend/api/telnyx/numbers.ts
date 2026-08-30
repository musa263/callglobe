import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../_lib/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError, requiredEnv } from '../_lib/http.js';
import { telnyx, telnyxPstnConnectionId } from '../_lib/telnyx.js';
import { readPbxConfig } from '../_lib/pbx-config-store.js';
import { sessionCanAccessNumber } from '../_lib/tenancy.js';

type TelnyxNumber = {
  id: string;
  phone_number: string;
  country_iso_alpha2?: string;
  status?: string;
  connection_id?: string | null;
  connection_name?: string | null;
  messaging_profile_id?: string | null;
  tags?: string[];
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const session = await requireSession(req);
    const connectionId = requiredEnv('TELNYX_CONNECTION_ID');
    const callControlApplicationId = requiredEnv('TELNYX_CALL_CONTROL_APP_ID');
    const pstnConnectionId = telnyxPstnConnectionId();
    const config = await readPbxConfig();
    const response = await telnyx('/phone_numbers?page[size]=250&filter[status]=active');
    const payload = await response.json() as { data?: TelnyxNumber[] };
    const numbers = (payload.data ?? []).filter((number) => sessionCanAccessNumber(session, number.phone_number, config)).map((number) => ({
      id: number.id,
      phone_number: number.phone_number,
      label: config.numberAssignments[number.phone_number]?.label || number.connection_name || 'Vocivo number',
      country_code: number.country_iso_alpha2 || null,
      status: number.status || 'active',
      receives_calls: [connectionId, callControlApplicationId, pstnConnectionId].includes(number.connection_id || ''),
      messaging_enabled: Boolean(number.messaging_profile_id),
      source: 'owned',
    }));
    return res.status(200).json({ numbers });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    return res.status(500).json({ error: publicError(error) });
  }
}

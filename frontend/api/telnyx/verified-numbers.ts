import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { requireSession } from '../_lib/auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../_lib/http.js';
import { telnyx, TelnyxApiError } from '../_lib/telnyx.js';
import { readPbxConfig } from '../_lib/pbx-config-store.js';
import { assignNumberToOrganization, removeNumberAssignment, sessionCanAccessNumber, sessionOrganizationId } from '../_lib/tenancy.js';
import { invalidatePhoneNumberCache } from '../_lib/phone-number-access.js';

const e164Pattern = /^\+[1-9]\d{6,14}$/;

function phoneNumberFrom(req: VercelRequest) {
  const value = req.method === 'DELETE' ? req.query.phone_number : req.body?.phone_number;
  return typeof value === 'string' ? value.replace(/[\s()-]/g, '') : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'POST', 'DELETE'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);

  try {
    const session = await requireSession(req);
    const config = await readPbxConfig();
    const organizationId = sessionOrganizationId(session, config);

    if (req.method === 'GET') {
      const response = await telnyx('/verified_numbers?page[size]=250');
      const payload = await response.json() as { data?: Array<{ phone_number: string; verified_at?: string }> };
      return res.status(200).json({
        numbers: (payload.data ?? []).filter((number) => sessionCanAccessNumber(session, number.phone_number, config)).map((number) => ({
          id: `verified-${number.phone_number}`,
          phone_number: number.phone_number,
          label: 'Verified caller ID',
          country_code: parsePhoneNumberFromString(number.phone_number)?.country || null,
          verified_at: number.verified_at || null,
          receives_calls: false,
          source: 'verified',
        })),
      });
    }

    const phoneNumber = phoneNumberFrom(req);
    if (!e164Pattern.test(phoneNumber)) return res.status(400).json({ error: 'Enter a complete number in international format, for example +966501234567.' });
    if (req.method === 'DELETE' && !sessionCanAccessNumber(session, phoneNumber, config)) return res.status(403).json({ error: 'This caller ID belongs to another organization.' });

    if (req.method === 'DELETE') {
      await telnyx(`/verified_numbers/${encodeURIComponent(phoneNumber)}`, { method: 'DELETE' });
      await removeNumberAssignment(phoneNumber);
      invalidatePhoneNumberCache('verified');
      return res.status(200).json({ success: true });
    }

    const action = req.body?.action;
    if (action === 'request') {
      const verificationMethod = req.body?.verification_method === 'call' ? 'call' : 'sms';
      const response = await telnyx('/verified_numbers', {
        method: 'POST',
        body: JSON.stringify({ phone_number: phoneNumber, verification_method: verificationMethod }),
      });
      const payload = await response.json();
      console.info(`Verified number request accepted: method=${verificationMethod}, destination=***${phoneNumber.slice(-4)}`);
      return res.status(200).json({ pending: true, phone_number: phoneNumber, verification_method: verificationMethod, ...payload });
    }

    if (action === 'verify') {
      const verificationCode = typeof req.body?.verification_code === 'string' ? req.body.verification_code.trim() : '';
      if (!/^\d{4,8}$/.test(verificationCode)) return res.status(400).json({ error: 'Enter the verification code sent by Telnyx.' });
      const response = await telnyx(`/verified_numbers/${encodeURIComponent(phoneNumber)}/actions/verify`, {
        method: 'POST',
        body: JSON.stringify({ verification_code: verificationCode }),
      });
      await assignNumberToOrganization(phoneNumber, organizationId);
      invalidatePhoneNumberCache('verified');
      return res.status(200).json(await response.json());
    }

    return res.status(400).json({ error: 'Unknown verification action.' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof TelnyxApiError && [400, 404, 422].includes(error.status)) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}

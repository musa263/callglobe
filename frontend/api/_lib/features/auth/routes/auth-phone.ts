import type { VercelRequest, VercelResponse } from '@vercel/node';
import { allowMobile, methodNotAllowed, requiredEnv } from '../../../shared/http.js';
import { createExtensionSession, setSessionCookies } from '../auth.js';
import { requestIp } from '../auth-rate-limit.js';
import { createPhoneOtp, PhoneAuthError } from '../phone-otp.js';
import { phoneAuthStore, phoneIdentityHash } from '../phone-auth-store.js';
import { individualAccount } from '../individual-account.js';
import { readSignupPlans } from '../../organizations/saas-store.js';

// The general carrier wrapper logs error bodies, which can contain OTPs and phone numbers.
async function verifyRequest(path: string, body: object) {
  const response = await fetch(`https://api.telnyx.com/v2${path}`, { method: 'POST', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${requiredEnv('TELNYX_API_KEY')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new PhoneAuthError('Phone verification could not be completed. Please try again later.', 503);
  return response.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  res.setHeader('Cache-Control', 'no-store');
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return res.status(415).json({ error: 'A JSON request is required.' });
  try {
    const profileId = process.env.TELNYX_VERIFY_PROFILE_ID || '';
    const planId = process.env.VOCIVO_INDIVIDUAL_PLAN_ID || '';
    const countries = (process.env.VOCIVO_OTP_COUNTRIES || '').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
    const dailyLimit = Number(process.env.VOCIVO_OTP_DAILY_LIMIT || 100);
    if (process.env.VOCIVO_PHONE_SIGNUP_ENABLED !== 'true' || !/^[a-f\d-]{36}$/i.test(profileId) || !planId || !countries.length || !Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 10000) throw new PhoneAuthError('Phone signup is not available yet. Please contact Vocivo support.', 503);
    if (!['start', 'verify'].includes(req.body?.step)) throw new PhoneAuthError('Choose a valid verification step.');
    const service = createPhoneOtp({
      store: phoneAuthStore, hash: phoneIdentityHash, countries, dailyLimit,
      send: async (phone) => {
        const plans = await readSignupPlans();
        if (!plans.some((plan) => plan.id === planId && plan.active && plan.monthlyPrice === 0)) throw new PhoneAuthError('Individual signup is not configured yet.', 503);
        const { data } = await verifyRequest('/verifications/sms', { phone_number: phone, verify_profile_id: profileId, timeout_secs: 300 });
        if (!data?.id || data.phone_number !== phone || data.verify_profile_id !== profileId) throw new Error('Unexpected verification response.');
        return String(data.id);
      },
      verify: async (id, code, phone) => {
        const { data } = await verifyRequest(`/verifications/${encodeURIComponent(id)}/actions/verify`, { code });
        return data?.response_code === 'accepted' && data.phone_number === phone;
      },
    });
    if (req.body.step === 'start') {
      // No unapproved subscription price or SMS charge until an operator configures launch.
      return res.status(200).json(await service.start({ phone: req.body.phone, name: req.body.name }, requestIp(req)));
    }
    const verified = await service.finish(req.body.challengeId, req.body.code, requestIp(req));
    const { extension, organization, access } = await individualAccount(verified.phone, verified.name, planId);
    const token = await createExtensionSession({ ...extension, accountType: 'individual', role: 'individual' });
    setSessionCookies(res, token, 30 * 86400);
    return res.status(200).json({ token, profile: { id: extension.id, email: extension.email, full_name: extension.name, mobile: verified.phone, currency: 'USD', role: 'individual', account_type: 'individual', organization_id: organization.id, organization_name: organization.name, entitlements: access.features } });
  } catch (error) {
    if (error instanceof PhoneAuthError) {
      if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
      return res.status(error.status).json({ error: error.message, retryAfter: error.retryAfter });
    }
    // Provider errors may contain the destination or OTP. Never log their raw payload.
    console.error('[Vocivo Phone Auth] Verification or provisioning failed', { event: 'phone_auth_failed' });
    return res.status(503).json({ error: 'Phone verification is temporarily unavailable. Please try again later.' });
  }
}

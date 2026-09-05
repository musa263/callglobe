import type { VercelRequest, VercelResponse } from '@vercel/node';
import bcrypt from 'bcryptjs';
import { createSession, createTenantAdminSession, setSessionCookies } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, requiredEnv } from '../../../shared/http.js';
import { readPasswordHash } from '../../numbers/number-config.js';
import { readPbxConfig } from '../../organizations/pbx-config-store.js';
import { authenticateTenantAdmin, effectiveEntitlements, readTenantSaasState } from '../../organizations/saas-store.js';
import { checkLoginRateLimit, clearAccountLoginFailures, recordLoginFailure, requestIp } from '../auth-rate-limit.js';
import { quarantineSecurityEvent } from '../../../shared/security-quarantine.js';
import { VOCIVO_PLATFORM_NAME, VOCIVO_SUPERADMIN_NAME } from '../../organizations/platform-identity.js';

function securityLog(event: string, input: { accountHash: string; ipHash: string; retryAfterSeconds?: number }) {
  console.warn(JSON.stringify({
    level: 'security',
    event,
    account: input.accountHash.slice(0, 16),
    sourceIp: input.ipHash.slice(0, 16),
    retryAfterSeconds: input.retryAfterSeconds || 0,
    occurredAt: new Date().toISOString(),
  }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const ip = requestIp(req);
    const rateLimit = await checkLoginRateLimit(email, ip);
    if (rateLimit.blocked) {
      securityLog('auth.login.blocked', rateLimit);
      res.setHeader('Retry-After', String(Math.max(1, rateLimit.retryAfterSeconds)));
      return res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
    }
    const reject = async () => {
      const failure = await recordLoginFailure(email, ip);
      securityLog('auth.login.failed', failure);
      if (failure.blocked) {
        await quarantineSecurityEvent({
          source: 'auth-login',
          reason: 'login_rate_limit_lockout',
          details: { accountHash: failure.accountHash, ipHash: failure.ipHash, retryAfterSeconds: failure.retryAfterSeconds },
        });
        res.setHeader('Retry-After', String(Math.max(1, failure.retryAfterSeconds)));
        return res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
      }
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    };
    const expectedEmail = requiredEnv('APP_ADMIN_EMAIL').trim().toLowerCase();
    if (email === expectedEmail) {
      const passwordHash = await readPasswordHash().catch(() => requiredEnv('APP_PASSWORD_HASH'));
      const valid = await bcrypt.compare(password, passwordHash);
      if (!valid) return reject();
      await clearAccountLoginFailures(email, ip);
      const token = await createSession(email);
      setSessionCookies(res, token, 60 * 60 * 24 * 30);
      return res.status(200).json({
        token,
        profile: {
          id: 'vocivo-owner', email, full_name: process.env.APP_ADMIN_NAME || VOCIVO_SUPERADMIN_NAME, currency: 'USD',
          role: 'superadmin', account_type: 'platform', organization_name: VOCIVO_PLATFORM_NAME,
          organization_owner: VOCIVO_PLATFORM_NAME, admin_only: true,
        },
      });
    }

    const config = await readPbxConfig();
    const account = await authenticateTenantAdmin(email, password, config);
    const organization = account ? config.organizations.find((item) => item.id === account.organizationId && item.status === 'active') : undefined;
    if (!account || !organization) return reject();
    const access = effectiveEntitlements(await readTenantSaasState(organization.id, config), organization.id, organization.accountType);
    if (!access.serviceActive) return res.status(403).json({ error: 'This company subscription is not active. Contact Vocivo support.' });
    const token = await createTenantAdminSession(account);
    setSessionCookies(res, token, 60 * 60 * 12);
    await clearAccountLoginFailures(email, ip);
    return res.status(200).json({
      token,
      profile: {
        id: account.id, email: account.email, full_name: account.name, currency: access.subscription.currency,
        role: account.role, account_type: organization.accountType, organization_id: organization.id,
        organization_name: organization.name, organization_owner: organization.ownerDisplayName,
        extension: account.extension, admin_only: !account.extensionId,
        force_password_change: account.forcePasswordChange, entitlements: access.features,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: publicError(error) });
  }
}

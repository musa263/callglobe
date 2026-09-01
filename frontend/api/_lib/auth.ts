import type { VercelRequest } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { requiredEnv } from './http.js';
import { put } from './object-store.js';
import { readStoredObject } from './stored-object-read.js';
import { isExtensionSessionRevoked } from './extension-session-store.js';
import { activeTenantAdmin, type TenantAdminAccount } from './saas-store.js';
import { readPbxConfig } from './pbx-config-store.js';

const issuer = 'vocivo-vercel';
const audience = 'vocivo-mobile';

function key() {
  return new TextEncoder().encode(requiredEnv('AUTH_SECRET'));
}

export async function createSession(email: string) {
  return new SignJWT({ email, role: 'superadmin', accountType: 'platform' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('vocivo-owner')
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(key());
}

export type VocivoSession = JWTPayload & {
  email?: string;
  name?: string;
  role?: 'owner' | 'admin' | 'superadmin' | 'company_owner' | 'company_admin' | 'manager' | 'user' | 'individual';
  accountType?: 'platform' | 'business' | 'individual';
  extensionId?: string;
  extension?: string;
  organizationId?: string;
  accountId?: string;
  forcePasswordChange?: boolean;
};

export async function createTenantAdminSession(account: TenantAdminAccount) {
  return new SignJWT({
    email: account.email,
    name: account.name,
    role: account.role,
    accountType: 'business',
    accountId: account.id,
    extensionId: account.extensionId,
    extension: account.extension,
    organizationId: account.organizationId,
    forcePasswordChange: account.forcePasswordChange,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(`vocivo-account:${account.id}`)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(key());
}

export async function createExtensionSession(input: { id: string; email: string; name: string; role: 'company_owner' | 'company_admin' | 'manager' | 'user' | 'individual'; extension: string; organizationId: string; accountType: 'business' | 'individual' }) {
  return new SignJWT({ email: input.email, name: input.name, role: input.role, accountType: input.accountType, extensionId: input.id, extension: input.extension, organizationId: input.organizationId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(`vocivo-extension:${input.id}`)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(key());
}

export async function createEnrollmentToken(extensionId: string) {
  return new SignJWT({ purpose: 'extension-enrollment', extensionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('vocivo-enrollment')
    .setIssuer(issuer)
    .setAudience(audience)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(key());
}

export async function verifyEnrollmentToken(token: string) {
  const { payload } = await jwtVerify(token, key(), { issuer, audience });
  if (payload.sub !== 'vocivo-enrollment' || payload.purpose !== 'extension-enrollment' || typeof payload.extensionId !== 'string' || typeof payload.jti !== 'string') throw new Error('Invalid enrollment code.');
  return { extensionId: payload.extensionId, jti: payload.jti };
}

async function verifySessionToken(req: VercelRequest) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new Error('Unauthorized');
  const token = header.slice(7);
  const { payload } = await jwtVerify(token, key(), { issuer, audience });
  if (typeof payload.sub !== 'string' || payload.sub !== 'vocivo-owner' && !payload.sub.startsWith('vocivo-extension:') && !payload.sub.startsWith('vocivo-account:')) throw new Error('Unauthorized');
  return payload as JWTPayload & { sub: string };
}

function requestPath(req: VercelRequest) {
  return String(req.url || '').split('?')[0];
}

function allowsForcedPasswordChange(req: VercelRequest) {
  const path = requestPath(req);
  return path === '/api/auth/session' || path === '/api/auth/password';
}

const ownerInvalidationPath = 'vocivo/auth/owner-sessions-invalidated-at';
let ownerInvalidationCache: { checkedAt: number; invalidatedAtSeconds: number } | undefined;

export async function invalidateOwnerSessions() {
  await put(ownerInvalidationPath, new Date().toISOString(), { access: 'private', contentType: 'text/plain', allowOverwrite: true });
  ownerInvalidationCache = undefined;
}

async function ownerSessionsInvalidatedAtSeconds() {
  if (ownerInvalidationCache && Date.now() - ownerInvalidationCache.checkedAt < 15_000) return ownerInvalidationCache.invalidatedAtSeconds;
  try {
    const value = await readStoredObject(ownerInvalidationPath);
    const invalidatedAt = value ? Date.parse(value.toString('utf8').trim()) : Number.NaN;
    const invalidatedAtSeconds = Number.isFinite(invalidatedAt) ? Math.floor(invalidatedAt / 1000) : 0;
    ownerInvalidationCache = { checkedAt: Date.now(), invalidatedAtSeconds };
    return invalidatedAtSeconds;
  } catch (error) {
    // Fail open only on a transient storage error so the owner is not locked out.
    console.error('Unable to read the owner session invalidation marker.', error);
    return 0;
  }
}

async function assertOwnerSessionCurrent(payload: JWTPayload) {
  const invalidatedAtSeconds = await ownerSessionsInvalidatedAtSeconds();
  if (invalidatedAtSeconds && (typeof payload.iat !== 'number' || payload.iat < invalidatedAtSeconds)) throw new Error('Unauthorized');
}

export async function requireSession(req: VercelRequest) {
  const payload = await verifySessionToken(req);
  const tenantSession = payload.sub.startsWith('vocivo-extension:') || payload.sub.startsWith('vocivo-account:');
  if (tenantSession) {
    if (typeof payload.organizationId !== 'string' || !payload.organizationId.trim()) throw new Error('Unauthorized');
    const config = await readPbxConfig();
    if (!config.organizations.some((organization) => organization.id === payload.organizationId && organization.status === 'active')) throw new Error('Unauthorized');
  }
  if (payload.sub.startsWith('vocivo-extension:')) {
    if (typeof payload.extensionId !== 'string' || typeof payload.extension !== 'string' || typeof payload.iat !== 'number') throw new Error('Unauthorized');
    if (await isExtensionSessionRevoked(payload.extensionId, payload.iat)) throw new Error('Unauthorized');
  }
  if (payload.sub.startsWith('vocivo-account:')) {
    if (typeof payload.accountId !== 'string' || typeof payload.organizationId !== 'string' || !['company_owner', 'company_admin'].includes(String(payload.role))) throw new Error('Unauthorized');
    const account = await activeTenantAdmin(payload.accountId, payload.organizationId);
    if (!account) throw new Error('Unauthorized');
    const session = {
      ...payload,
      email: account.email,
      name: account.name,
      role: account.role,
      extensionId: account.extensionId,
      extension: account.extension,
      organizationId: account.organizationId,
      forcePasswordChange: account.forcePasswordChange,
    } as VocivoSession;
    if (session.forcePasswordChange && !allowsForcedPasswordChange(req)) throw new Error('Password change required');
    return session;
  }
  if (payload.sub === 'vocivo-owner') await assertOwnerSessionCurrent(payload);
  return payload as VocivoSession;
}

export async function requireOwner(req: VercelRequest) {
  const payload = await verifySessionToken(req) as VocivoSession;
  if (payload.sub !== 'vocivo-owner' || !['owner', 'superadmin'].includes(payload.role || '')) throw new Error('Forbidden');
  await assertOwnerSessionCurrent(payload);
  return payload;
}

export async function requireAdmin(req: VercelRequest) {
  const session = await requireSession(req);
  const superadmin = session.sub === 'vocivo-owner' && ['owner', 'superadmin'].includes(session.role || '');
  const companyAdmin = Boolean(session.organizationId && (session.extensionId || session.accountId) && ['company_owner', 'company_admin'].includes(session.role || ''));
  if (!superadmin && !companyAdmin) throw new Error('Forbidden');
  return { session, superadmin, organizationId: superadmin ? undefined : session.organizationId };
}

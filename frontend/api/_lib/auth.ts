import type { VercelRequest } from '@vercel/node';
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { requiredEnv } from './http.js';

const issuer = 'vocivo-vercel';
const audience = 'vocivo-mobile';

function key() {
  return new TextEncoder().encode(requiredEnv('AUTH_SECRET'));
}

export async function createSession(email: string) {
  return new SignJWT({ email, role: 'owner' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('vocivo-owner')
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(key());
}

export type VocivoSession = JWTPayload & {
  email?: string;
  name?: string;
  role?: 'owner' | 'admin' | 'manager' | 'user';
  extensionId?: string;
  extension?: string;
  organizationId?: string;
};

export async function createExtensionSession(input: { id: string; email: string; name: string; role: 'admin' | 'manager' | 'user'; extension: string; organizationId: string }) {
  return new SignJWT({ email: input.email, name: input.name, role: input.role, extensionId: input.id, extension: input.extension, organizationId: input.organizationId })
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
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(key());
}

export async function verifyEnrollmentToken(token: string) {
  const { payload } = await jwtVerify(token, key(), { issuer, audience });
  if (payload.sub !== 'vocivo-enrollment' || payload.purpose !== 'extension-enrollment' || typeof payload.extensionId !== 'string') throw new Error('Invalid enrollment code.');
  return payload.extensionId;
}

export async function requireSession(req: VercelRequest) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new Error('Unauthorized');
  const token = header.slice(7);
  const { payload } = await jwtVerify(token, key(), { issuer, audience });
  if (payload.sub !== 'vocivo-owner' && !payload.sub?.startsWith('vocivo-extension:')) throw new Error('Unauthorized');
  return payload as VocivoSession;
}

export async function requireOwner(req: VercelRequest) {
  const session = await requireSession(req);
  if (session.sub !== 'vocivo-owner' || session.role !== 'owner') throw new Error('Forbidden');
  return session;
}

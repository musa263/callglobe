import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { requiredEnv } from './http.js';

export function sipEdgeAuthorized(req: VercelRequest) {
  const expected = requiredEnv('SIP_EDGE_SECRET');
  const header = String(req.headers.authorization || '');
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : String(req.headers['x-vocivo-sip-edge'] || '');
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export function newSipPassword() {
  return randomBytes(24).toString('base64url');
}

function nonceSecret() {
  return `${requiredEnv('AUTH_SECRET')}:sip-nonce`;
}

/** Self-contained HMAC nonce so sip-auth can reject captured Kamailio nonces. */
export function issueSipNonce(username: string, ttlMs = 120_000) {
  const expiresAt = Date.now() + ttlMs;
  const payload = Buffer.from(JSON.stringify({ u: username, e: expiresAt }), 'utf8').toString('base64url');
  const sig = createHmac('sha256', nonceSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** @deprecated use issueSipNonce */
export function signedSipNonce(username: string, expiresAt: number) {
  return issueSipNonce(username, Math.max(1, expiresAt - Date.now()));
}

export function verifySipNonce(username: string, nonce: string) {
  const dot = nonce.lastIndexOf('.');
  if (dot < 8) return false;
  const payload = nonce.slice(0, dot);
  const sig = nonce.slice(dot + 1);
  const expected = createHmac('sha256', nonceSecret()).update(payload).digest('base64url');
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || left.length === 0 || !timingSafeEqual(left, right)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u?: string; e?: number };
    return data.u === username && typeof data.e === 'number' && data.e > Date.now();
  } catch {
    return false;
  }
}

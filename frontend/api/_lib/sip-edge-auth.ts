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

export function signedSipNonce(username: string, expiresAt: number) {
  return createHmac('sha256', `${requiredEnv('AUTH_SECRET')}:sip-nonce`).update(`${username}:${expiresAt}`).digest('base64url');
}

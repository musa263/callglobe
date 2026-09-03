import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { requiredEnv } from './http.js';

function secretMatches(expected: string, supplied: string) {
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/**
 * Kamailio and the dialplan curl hooks send `Authorization: Bearer <secret>` (or
 * X-Vocivo-Sip-Edge); mod_xml_curl can only do HTTP Basic, so `<anything>:<secret>`
 * is accepted too. Every comparison is constant-time.
 */
export function sipEdgeAuthorized(req: VercelRequest) {
  const expected = requiredEnv('SIP_EDGE_SECRET');
  const header = String(req.headers.authorization || '');
  if (header.startsWith('Bearer ')) return secretMatches(expected, header.slice(7));
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    return separator >= 0 && secretMatches(expected, decoded.slice(separator + 1));
  }
  return secretMatches(expected, String(req.headers['x-vocivo-sip-edge'] || ''));
}

export function newSipPassword() {
  return randomBytes(24).toString('base64url');
}

export function signedSipNonce(username: string, expiresAt: number) {
  return createHmac('sha256', `${requiredEnv('AUTH_SECRET')}:sip-nonce`).update(`${username}:${expiresAt}`).digest('base64url');
}

/** How long a challenge may be answered. Phones answer within a second; five minutes covers a slow network. */
export const sipNonceLifetimeMs = 5 * 60 * 1000;

/**
 * A nonce the API issued for one username: `<expires>.<signature>`. Kamailio
 * puts it in the 401, the phone answers it, and sip-auth checks the answer was
 * to a nonce of ours that has not expired — which is what stops a captured
 * Authorization header from being replayed later.
 */
export function issueSipNonce(username: string, now = new Date()) {
  const expiresAt = Math.floor(now.getTime() / 1000) + Math.floor(sipNonceLifetimeMs / 1000);
  return `${expiresAt}.${signedSipNonce(username, expiresAt)}`;
}

export function sipNonceIsValid(nonce: string, username: string, now = new Date()) {
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{20,})$/.exec(nonce);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < now.getTime()) return false;
  return secretMatches(signedSipNonce(username, expiresAt), match[2]);
}

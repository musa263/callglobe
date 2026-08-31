import { createHash, timingSafeEqual } from 'node:crypto';
import { claimReplayKey } from './object-store.js';

export type DigestChallenge = {
  username: string;
  realm: string;
  nonce: string;
  uri: string;
  response: string;
  method: string;
  cnonce?: string;
  nc?: string;
  qop?: string;
};

export function md5Hex(value: string) {
  return createHash('md5').update(value).digest('hex');
}

export function digestHa1(username: string, realm: string, password: string) {
  return md5Hex(`${username}:${realm}:${password}`);
}

export function digestExpectedResponse(ha1: string, challenge: DigestChallenge) {
  const ha2 = md5Hex(`${challenge.method}:${challenge.uri}`);
  if (challenge.qop) {
    return md5Hex(`${ha1}:${challenge.nonce}:${challenge.nc || ''}:${challenge.cnonce || ''}:${challenge.qop}:${ha2}`);
  }
  return md5Hex(`${ha1}:${challenge.nonce}:${ha2}`);
}

export function digestMatches(ha1: string, challenge: DigestChallenge) {
  const expected = Buffer.from(digestExpectedResponse(ha1, challenge), 'utf8');
  const supplied = Buffer.from(challenge.response, 'utf8');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

const usedNonces = new Map<string, number>();

export function consumeDigestReplay(username: string, nonce: string, nc?: string) {
  const key = `${username}:${nonce}:${nc || 'none'}`;
  const now = Date.now();
  for (const [seen, at] of usedNonces) {
    if (now - at > 10 * 60 * 1000) usedNonces.delete(seen);
  }
  if (usedNonces.has(key)) return false;
  usedNonces.set(key, now);
  return true;
}

export async function consumeDigestReplayDurable(username: string, nonce: string, nc?: string) {
  const digest = createHash('sha256').update(`${username}:${nonce}:${nc || 'none'}`).digest('hex').slice(0, 32);
  try {
    return await claimReplayKey(`sipn:${digest}`, new Date(Date.now() + 10 * 60 * 1000));
  } catch {
    return consumeDigestReplay(username, nonce, nc);
  }
}

export function parseDigestAuthorization(header: string, method = 'REGISTER'): DigestChallenge | null {
  const raw = header.trim();
  if (!raw) return null;
  const value = raw.replace(/^Digest\s+/i, '');
  const fields: Record<string, string> = {};
  const token = /([a-z][a-z0-9_-]*)\s*=\s*(?:"([^"]*)"|([^,\s]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = token.exec(value))) {
    fields[match[1].toLowerCase()] = match[2] ?? match[3] ?? '';
  }
  const username = fields.username || '';
  const realm = fields.realm || '';
  const nonce = fields.nonce || '';
  const uri = fields.uri || '';
  const response = fields.response || '';
  if (!username || !realm || !nonce || !uri || !response) return null;
  return {
    username,
    realm,
    nonce,
    uri,
    response,
    method: method.toUpperCase() || 'REGISTER',
    cnonce: fields.cnonce || undefined,
    nc: fields.nc || undefined,
    qop: fields.qop || undefined,
  };
}

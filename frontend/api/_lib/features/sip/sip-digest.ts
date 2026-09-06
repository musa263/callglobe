import { createHash, timingSafeEqual } from 'node:crypto';

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
  algorithm?: string;
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
  // HA1 rows and the edge challenge currently use MD5. Never interpret a
  // SHA-256, session algorithm, or auth-int response as an MD5 auth digest.
  if ((challenge.algorithm || 'MD5').toUpperCase() !== 'MD5') return false;
  if (challenge.qop && (challenge.qop !== 'auth' || !challenge.cnonce || !/^[0-9a-f]{8}$/i.test(challenge.nc || '') || parseInt(challenge.nc!, 16) === 0)) return false;
  if (!/^[0-9a-f]{32}$/i.test(challenge.response)) return false;
  const expected = Buffer.from(digestExpectedResponse(ha1, challenge), 'utf8');
  const supplied = Buffer.from(challenge.response.toLowerCase(), 'utf8');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function parseDigestAuthorization(header: string, method = 'REGISTER'): DigestChallenge | null {
  const raw = header.trim();
  if (!/^Digest\s+/i.test(raw)) return null;
  const value = raw.replace(/^Digest\s+/i, '');
  if (/[\r\n]/.test(value)) return null;
  const fields: Record<string, string> = Object.create(null);
  const token = /\s*([a-z][a-z0-9_-]*)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^,\s"]+))\s*(,|$)/giy;
  let cursor = 0;
  while (cursor < value.length) {
    token.lastIndex = cursor;
    const match = token.exec(value);
    if (!match) return null;
    const key = match[1].toLowerCase();
    if (key in fields) return null;
    fields[key] = match[2] !== undefined ? match[2].replace(/\\(.)/g, '$1') : match[3];
    cursor = token.lastIndex;
    if (match[4] && !value.slice(cursor).trim()) return null;
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
    algorithm: fields.algorithm || 'MD5',
  };
}

import { createHash } from 'node:crypto';
import type { DigestChallenge } from './sip-digest.js';

export type RegistrationIdentity = {
  fromUser: string;
  toUser: string;
  fromDomain: string;
  toDomain: string;
  requestUri: string;
};

/** Reject ambiguous encodings instead of normalizing one tenant's AOR into another. */
export function ownsSipRegistration(challenge: DigestChallenge, identity: RegistrationIdentity) {
  const user = challenge.username;
  const realm = challenge.realm.toLowerCase();
  if (challenge.method !== 'REGISTER' || !/^[A-Za-z0-9_.-]{1,80}$/.test(user)) return false;
  if (!/^[a-z0-9.-]+$/.test(realm)) return false;
  if (identity.fromUser !== user || identity.toUser !== user) return false;
  if (identity.fromDomain.toLowerCase() !== realm || identity.toDomain.toLowerCase() !== realm) return false;
  // Digest must authenticate the actual request target, not an unrelated URI.
  if (challenge.uri !== identity.requestUri) return false;
  const target = /^sips?:([^@;?\s]+)(?:;transport=(?:tcp|tls|ws|wss|udp))?$/i.exec(identity.requestUri);
  return Boolean(target && target[1].toLowerCase().replace(/:\d+$/, '') === realm);
}

export function sipDigestReplayKey(challenge: DigestChallenge) {
  if (challenge.qop !== 'auth' || !/^[0-9a-f]{8}$/i.test(challenge.nc || '') || parseInt(challenge.nc!, 16) === 0 || !challenge.cnonce) return null;
  return `sip-digest:${createHash('sha256').update(JSON.stringify([
    challenge.username, challenge.realm, challenge.nonce, challenge.cnonce, challenge.nc!.toLowerCase(),
  ])).digest('hex')}`;
}

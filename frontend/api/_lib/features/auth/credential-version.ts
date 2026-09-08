import { createHmac, timingSafeEqual } from 'node:crypto';
import { requiredEnv } from '../../shared/http.js';

export function credentialVersion(hash: string) {
  return createHmac('sha256', requiredEnv('AUTH_SECRET')).update(`credential-session:v1:${hash}`).digest('hex');
}
export function assertCredentialVersion(presented: unknown, hash: string) {
  const expected = credentialVersion(hash);
  if (typeof presented !== 'string' || !/^[a-f0-9]{64}$/.test(presented)
    || !timingSafeEqual(Buffer.from(presented, 'hex'), Buffer.from(expected, 'hex'))) throw new Error('Unauthorized');
}

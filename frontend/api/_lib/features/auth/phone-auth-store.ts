import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { transactObject } from '../../shared/object-store.js';
import { requiredEnv } from '../../shared/http.js';
import type { PhoneAuthStore } from './phone-otp.js';

const key = () => createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:phone-auth:v1`).digest();
export const phoneIdentityHash = (value: string) => createHmac('sha256', key()).update(value).digest('hex');
export const phoneAuthStore: PhoneAuthStore = {
  async mutate<T>(id: string, update: (current: T | null) => T) {
    let result!: T;
    await transactObject(`vocivo/auth/phone/${id}.bin`, (body) => {
      let current: T | null = null;
      if (body) {
        const decipher = createDecipheriv('aes-256-gcm', key(), body.subarray(0, 12));
        decipher.setAuthTag(body.subarray(12, 28));
        current = JSON.parse(Buffer.concat([decipher.update(body.subarray(28)), decipher.final()]).toString('utf8')) as T;
      }
      result = update(current);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key(), iv);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(result)), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    }, { access: 'private', contentType: 'application/octet-stream' });
    return result;
  },
};

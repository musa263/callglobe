import { randomUUID } from 'node:crypto';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

export class PhoneAuthError extends Error {
  constructor(message: string, public status = 400, public retryAfter = 0) { super(message); }
}

export type PhoneChallenge = { phone: string; name: string; providerId: string; expiresAt: number; attempts: number; state: 'pending' | 'checking' | 'used' };
export type PhoneAuthStore = {
  mutate<T>(key: string, update: (value: T | null) => T): Promise<T>;
};
type Dependencies = {
  store: PhoneAuthStore;
  hash(value: string): string;
  send(phone: string): Promise<string>;
  verify(id: string, code: string, phone: string): Promise<boolean>;
  countries: string[];
  dailyLimit: number;
  now?: () => number;
};

export function signupPhone(value: unknown, countries: string[]) {
  if (typeof value !== 'string' || value.length > 40 || !/^\+[\d\s()-]+$/.test(value)) throw new PhoneAuthError('Enter your full phone number, including its country code.');
  const phone = parsePhoneNumberFromString(value);
  if (!phone?.isValid() || !phone.country || !countries.includes(phone.country)) throw new PhoneAuthError('Phone signup is not available for this number.');
  return phone.number;
}

// All mutation callbacks are synchronous and side-effect free: the database may retry them.
export function createPhoneOtp(deps: Dependencies) {
  const now = deps.now || Date.now;
  async function reserve(key: string, limit: number, windowMs: number, cooldownMs = 0) {
    await deps.store.mutate<{ count: number; resetsAt: number; nextAt: number }>(`rate/${deps.hash(key)}`, (previous) => {
      const time = now();
      const value = previous && previous.resetsAt > time ? previous : { count: 0, resetsAt: time + windowMs, nextAt: 0 };
      const until = value.count >= limit ? value.resetsAt : value.nextAt;
      if (until > time) throw new PhoneAuthError('Please wait before trying again.', 429, Math.ceil((until - time) / 1000));
      return { ...value, count: value.count + 1, nextAt: time + cooldownMs };
    });
  }
  return {
    async start(input: { phone: unknown; name: unknown }, ip: string) {
      const phone = signupPhone(input.phone, deps.countries);
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (name.length < 2 || name.length > 50 || /[\x00-\x1f<>]/.test(name)) throw new PhoneAuthError('Enter your name (2 to 50 characters).');
      await reserve(`send-phone:${phone}`, 5, 3600_000, 60_000);
      await reserve(`send-ip:${ip}`, 20, 3600_000);
      await reserve('send-global', deps.dailyLimit, 86400_000);
      const challengeId = randomUUID();
      const expiresAt = now() + 300_000;
      const providerId = await deps.send(phone);
      await deps.store.mutate<PhoneChallenge>(`challenge/${challengeId}`, (existing) => {
        if (existing) throw new PhoneAuthError('Please request a new code.', 409);
        return { phone, name, providerId, expiresAt, attempts: 0, state: 'pending' };
      });
      return { challengeId, expiresAt, retryAfter: 60 };
    },
    async finish(challengeId: unknown, code: unknown, ip: string) {
      if (typeof challengeId !== 'string' || !/^[a-f\d-]{36}$/.test(challengeId) || typeof code !== 'string' || !/^\d{4,8}$/.test(code)) throw new PhoneAuthError('Enter the verification code from your SMS.');
      await reserve(`verify-ip:${ip}`, 30, 600_000);
      const key = `challenge/${challengeId}`;
      const challenge = await deps.store.mutate<PhoneChallenge>(key, (value) => {
        if (!value || value.expiresAt <= now() || value.state !== 'pending' || value.attempts >= 5) throw new PhoneAuthError('This code is unavailable or expired. Request a new one.', 409);
        return { ...value, attempts: value.attempts + 1, state: 'checking' };
      });
      let accepted = false;
      try { accepted = await deps.verify(challenge.providerId, code, challenge.phone); }
      finally {
        // A failed/ambiguous provider request never grants access. No parallel verifier can win.
        const settled = await deps.store.mutate<PhoneChallenge>(key, (value) => {
          if (!value || value.state !== 'checking' || value.attempts !== challenge.attempts) throw new PhoneAuthError('Request a new verification code.', 409);
          return { ...value, state: accepted && value.expiresAt > now() ? 'used' : 'pending' };
        });
        accepted = settled.state === 'used';
      }
      if (!accepted) throw new PhoneAuthError('The code is incorrect or expired.', 401);
      return { phone: challenge.phone, name: challenge.name };
    },
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneOtp, PhoneAuthError, signupPhone, type PhoneAuthStore } from './phone-otp.js';

function setup() {
  let time = 1000000;
  let sends = 0;
  let verifies = 0;
  let verify: () => Promise<boolean> = async () => true;
  const rows = new Map<string, unknown>();
  const store: PhoneAuthStore = { async mutate<T>(key: string, update: (value: T | null) => T) { const next = update(structuredClone(rows.get(key) ?? null) as T | null); rows.set(key, structuredClone(next)); return next; } };
  const service = createPhoneOtp({ store, hash: (value) => value, countries: ['US', 'GB'], dailyLimit: 100, now: () => time,
    send: async () => { sends++; return 'provider-id'; }, verify: async () => { verifies++; return verify(); },
  });
  return { service, rows, setVerify: (fn: typeof verify) => { verify = fn; }, advance: (ms: number) => { time += ms; }, sends: () => sends, verifies: () => verifies };
}
const input = { phone: '+12025550123', name: 'Alex Morgan' };
const status = (value: number) => (error: unknown) => error instanceof PhoneAuthError && error.status === value;

test('phone signup requires an explicit valid international number and approved country', () => {
  assert.equal(signupPhone('+1 (202) 555-0123', ['US']), input.phone);
  for (const phone of ['2025550123', '2000', '+971501234567', '+12025550123garbage']) assert.throws(() => signupPhone(phone, ['US']), PhoneAuthError);
});
test('accepted OTP returns only server-stored identity, and cannot be replayed', async () => {
  const { service, verifies } = setup();
  const challenge = await service.start(input, 'ip');
  assert.deepEqual(Object.keys(challenge).sort(), ['challengeId', 'expiresAt', 'retryAfter']);
  assert.deepEqual(await service.finish(challenge.challengeId, '123456', 'ip'), input);
  await assert.rejects(service.finish(challenge.challengeId, '123456', 'ip'), status(409));
  assert.equal(verifies(), 1);
});
test('parallel verify requests have one winner, not two sessions', async () => {
  const ctx = setup();
  let finish!: (accepted: boolean) => void;
  ctx.setVerify(() => new Promise((resolve) => { finish = resolve; }));
  const challenge = await ctx.service.start(input, 'ip');
  const first = ctx.service.finish(challenge.challengeId, '123456', 'ip');
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(ctx.service.finish(challenge.challengeId, '123456', 'ip'), status(409));
  finish(true); await first;
  assert.equal(ctx.verifies(), 1);
});
test('expiry before and during verification never creates an identity', async () => {
  const ctx = setup();
  const first = await ctx.service.start(input, 'ip');
  ctx.advance(300001);
  await assert.rejects(ctx.service.finish(first.challengeId, '123456', 'ip'), status(409));
  const second = await ctx.service.start(input, 'ip');
  ctx.setVerify(async () => { ctx.advance(300001); return true; });
  await assert.rejects(ctx.service.finish(second.challengeId, '123456', 'ip'), status(401));
});
test('five incorrect codes exhaust a challenge even if a later code is correct', async () => {
  const ctx = setup(); ctx.setVerify(async () => false);
  const challenge = await ctx.service.start(input, 'ip');
  for (let attempt = 0; attempt < 5; attempt++) await assert.rejects(ctx.service.finish(challenge.challengeId, '000000', 'ip'), status(401));
  ctx.setVerify(async () => true);
  await assert.rejects(ctx.service.finish(challenge.challengeId, '123456', 'ip'), status(409));
  assert.equal(ctx.verifies(), 5);
});
test('provider timeouts grant no identity and release the checking lock for a bounded retry', async () => {
  const ctx = setup(); ctx.setVerify(async () => { throw new Error('timeout'); });
  const challenge = await ctx.service.start(input, 'ip');
  await assert.rejects(ctx.service.finish(challenge.challengeId, '123456', 'ip'), /timeout/);
  ctx.setVerify(async () => true);
  assert.deepEqual(await ctx.service.finish(challenge.challengeId, '123456', 'ip'), input);
});
test('send cooldown is shared across IPs and cannot be raced', async () => {
  const ctx = setup();
  const results = await Promise.allSettled([ctx.service.start(input, 'ip-a'), ctx.service.start(input, 'ip-b')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(ctx.sends(), 1);
  ctx.advance(60001);
  await ctx.service.start(input, 'ip-b');
  assert.equal(ctx.sends(), 2);
});
test('hourly phone limit cannot be reset by requesting a new challenge', async () => {
  const ctx = setup();
  for (let i = 0; i < 5; i++) { await ctx.service.start(input, `ip-${i}`); ctx.advance(60001); }
  await assert.rejects(ctx.service.start(input, 'new-ip'), status(429));
  assert.equal(ctx.sends(), 5);
});

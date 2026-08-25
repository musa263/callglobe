import { createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';

function header(req: VercelRequest, name: string) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value || '';
}

function rawBody(req: VercelRequest) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  return Buffer.from(JSON.stringify(req.body ?? {}));
}

function ed25519Key(value: string) {
  if (value.includes('BEGIN PUBLIC KEY')) return createPublicKey(value);
  const raw = Buffer.from(value, 'base64');
  if (raw.length !== 32) throw new Error('TELNYX_PUBLIC_KEY must be a PEM key or a base64 Ed25519 key.');
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' });
}

function validLegacySecret(req: VercelRequest, secretName: 'VOICE_WEBHOOK_SECRET' | 'MESSAGING_WEBHOOK_SECRET') {
  const configured = process.env[secretName]?.trim();
  if (!configured) return false;
  const expected = Buffer.from(configured);
  const presented = Buffer.from(typeof req.query.token === 'string' ? req.query.token : '');
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

export function verifyTelnyxWebhook(req: VercelRequest, legacySecretName: 'VOICE_WEBHOOK_SECRET' | 'MESSAGING_WEBHOOK_SECRET' = 'VOICE_WEBHOOK_SECRET') {
  // Vercel may parse JSON before the function receives it, which makes an exact
  // Ed25519 body reconstruction impossible. Keep the scoped URL token as a
  // secure fallback instead of rejecting genuine carrier events.
  if (validLegacySecret(req, legacySecretName)) return true;
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  if (!publicKey) return false;
  const signature = header(req, 'telnyx-signature-ed25519');
  const timestamp = header(req, 'telnyx-timestamp');
  const timestampSeconds = Number(timestamp);
  if (!signature || !Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;
  const signed = Buffer.concat([Buffer.from(`${timestamp}|`), rawBody(req)]);
  try { return verify(null, signed, ed25519Key(publicKey), Buffer.from(signature, 'base64')); } catch { return false; }
}

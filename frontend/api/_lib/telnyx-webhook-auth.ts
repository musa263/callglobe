import { createPublicKey, verify } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';

function header(req: VercelRequest, name: string) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value || '';
}

async function rawBody(req: VercelRequest, maximum = 1024 * 1024) {
  const explicit = (req as VercelRequest & { rawBody?: Buffer | string }).rawBody;
  if (Buffer.isBuffer(explicit)) return explicit.length <= maximum ? explicit : null;
  if (typeof explicit === 'string') return Buffer.byteLength(explicit) <= maximum ? Buffer.from(explicit) : null;
  if (!(Symbol.asyncIterator in req)) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > maximum) return null;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function ed25519Key(value: string) {
  if (value.includes('BEGIN PUBLIC KEY')) return createPublicKey(value);
  const raw = Buffer.from(value, 'base64');
  if (raw.length !== 32) throw new Error('TELNYX_PUBLIC_KEY must be a PEM key or a base64 Ed25519 key.');
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  return createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' });
}

export async function verifyTelnyxWebhook(req: VercelRequest) {
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  if (!publicKey) return false;
  const signature = header(req, 'telnyx-signature-ed25519');
  const timestamp = header(req, 'telnyx-timestamp');
  const timestampSeconds = Number(timestamp);
  if (!signature || !Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;
  const raw = await rawBody(req);
  if (!raw) return false;
  const signed = Buffer.concat([Buffer.from(`${timestamp}|`), raw]);
  try {
    if (!verify(null, signed, ed25519Key(publicKey), Buffer.from(signature, 'base64'))) return false;
    req.body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    return true;
  } catch {
    return false;
  }
}

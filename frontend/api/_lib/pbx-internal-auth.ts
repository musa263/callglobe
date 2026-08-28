import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { requiredEnv } from './http.js';
import { claimReplayKey } from './object-store.js';

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function signPbxRequest(timestamp: string, nonce: string, body: string) {
  return `sha256=${createHmac('sha256', requiredEnv('VOCIVO_WEBHOOK_SECRET')).update(`${timestamp}.${nonce}.${body}`).digest('hex')}`;
}

type ReplayClaim = (replayKey: string, expiresAt: Date) => Promise<boolean>;

export async function verifyPbxRequest(req: VercelRequest, claim: ReplayClaim = claimReplayKey) {
  const timestamp = String(req.headers['x-vocivo-timestamp'] || '');
  const nonce = String(req.headers['x-vocivo-nonce'] || '');
  const signature = String(req.headers['x-vocivo-signature'] || '');
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) throw new Error('Unauthorized');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce)) throw new Error('Unauthorized');
  const body = canonicalJson(req.body ?? {});
  const expected = Buffer.from(signPbxRequest(timestamp, nonce, body));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Unauthorized');
  const digest = createHash('sha256').update(`${timestamp}.${nonce}.${signature}`).digest('hex');
  const accepted = await claim(`pbx:${digest}`, new Date((seconds + 301) * 1000));
  if (!accepted) throw new Error('Unauthorized');
}

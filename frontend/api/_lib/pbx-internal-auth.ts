import { createHmac, timingSafeEqual } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { requiredEnv } from './http.js';

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function signPbxRequest(timestamp: string, body: string) {
  return `sha256=${createHmac('sha256', requiredEnv('VOCIVO_WEBHOOK_SECRET')).update(`${timestamp}.${body}`).digest('hex')}`;
}

export function verifyPbxRequest(req: VercelRequest) {
  const timestamp = String(req.headers['x-vocivo-timestamp'] || '');
  const signature = String(req.headers['x-vocivo-signature'] || '');
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) throw new Error('Unauthorized');
  const expected = Buffer.from(signPbxRequest(timestamp, canonicalJson(req.body ?? {})));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Unauthorized');
}

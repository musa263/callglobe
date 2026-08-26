import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { put } from './object-store.js';
import type { VercelRequest } from '@vercel/node';
import { readStoredObject } from './stored-object-read.js';
import { requiredEnv } from './http.js';

export type PlatformScope = 'calls:read' | 'calls:write' | 'extensions:read' | 'numbers:read' | 'numbers:write' | 'events:read';
export type PlatformKey = { id: string; name: string; prefix: string; secretHash: string; organizationId: string; scopes: PlatformScope[]; createdAt: string; lastUsedAt?: string; revokedAt?: string };

const pathname = 'vocivo/platform/api-keys.bin';
const allowedScopes: PlatformScope[] = ['calls:read', 'calls:write', 'extensions:read', 'numbers:read', 'numbers:write', 'events:read'];

function key() { return createHash('sha256').update(requiredEnv('AUTH_SECRET')).digest(); }
function tokenHash(token: string) { return createHash('sha256').update(token).digest('hex'); }
function encrypt(value: PlatformKey[]) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv); const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]); }
function decrypt(value: Buffer) { const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as PlatformKey[]; }

export async function readPlatformKeys() {
  try {
    const value = await readStoredObject(pathname);
    return value ? decrypt(value) : [] as PlatformKey[];
  } catch { return []; }
}

async function writePlatformKeys(value: PlatformKey[]) { await put(pathname, encrypt(value), { access: 'private', contentType: 'application/octet-stream', allowOverwrite: true }); }

export async function createPlatformKey(input: { name?: unknown; organizationId?: unknown; scopes?: unknown }) {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
  if (!name) throw new Error('API key name is required.');
  const organizationId = typeof input.organizationId === 'string' && input.organizationId.trim() ? input.organizationId.trim().slice(0, 50) : 'primary';
  const scopes = Array.isArray(input.scopes) ? input.scopes.filter((scope): scope is PlatformScope => allowedScopes.includes(scope as PlatformScope)) : allowedScopes;
  if (!scopes.length) throw new Error('Choose at least one API scope.');
  const token = `vcp_live_${randomBytes(32).toString('base64url')}`;
  const item: PlatformKey = { id: crypto.randomUUID(), name, prefix: token.slice(0, 17), secretHash: tokenHash(token), organizationId, scopes, createdAt: new Date().toISOString() };
  const keys = await readPlatformKeys();
  await writePlatformKeys([...keys, item]);
  return { item, token };
}

export async function revokePlatformKey(id: string) {
  const keys = await readPlatformKeys();
  const index = keys.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('API key not found.');
  keys[index] = { ...keys[index], revokedAt: new Date().toISOString() };
  await writePlatformKeys(keys);
  return keys[index];
}

export async function authenticatePlatformKey(req: VercelRequest, requiredScope: PlatformScope) {
  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : typeof req.headers['x-vocivo-api-key'] === 'string' ? req.headers['x-vocivo-api-key'].trim() : '';
  if (!token.startsWith('vcp_live_')) throw new Error('Unauthorized');
  const presented = Buffer.from(tokenHash(token), 'hex');
  const keys = await readPlatformKeys();
  const match = keys.find((item) => !item.revokedAt && item.scopes.includes(requiredScope) && timingSafeEqual(Buffer.from(item.secretHash, 'hex'), presented));
  if (!match) throw new Error('Unauthorized');
  return match;
}

export function publicPlatformKey(item: PlatformKey) { const { secretHash: _secretHash, ...safe } = item; return safe; }

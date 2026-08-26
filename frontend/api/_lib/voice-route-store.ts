import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { put } from '@vercel/blob';
import { readFreshPublicBlob } from './blob-read.js';
import { requiredEnv } from './http.js';

export type ReservedVoiceRoute = {
  routeId: string;
  userId: string;
  organizationId: string;
  destination: string;
  callerId?: string;
  callerName?: string;
  callerExtension?: string;
  sourceExtensionId?: string;
  destinationName?: string;
  destinationExtension?: string;
  destinationExtensionId?: string;
  flow: 'outbound' | 'internal';
  phase: 'dialing' | 'ringing' | 'connected' | 'ended' | 'failed';
  failureCause?: string;
  connectedAt?: string;
  createdAt: string;
  expiresAt: string;
};

function key() { return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:voice-routes`).digest(); }
function routeHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function pathname(routeId: string) { return `vocivo/voice-routes/${routeHash(routeId)}.bin`; }
function encrypt(value: ReservedVoiceRoute) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
function decrypt(value: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as ReservedVoiceRoute;
}

export async function readVoiceRoute(routeId: string) {
  try {
    const value = await readFreshPublicBlob(pathname(routeId));
    if (!value) return null;
    const route = decrypt(value);
    return new Date(route.expiresAt).getTime() > Date.now() ? route : null;
  } catch { return null; }
}

export async function saveVoiceRoute(route: ReservedVoiceRoute) {
  await put(pathname(route.routeId), encrypt(route), { access: 'public', contentType: 'application/octet-stream', allowOverwrite: true });
  return route;
}

export async function updateVoiceRoute(routeId: string, patch: Partial<ReservedVoiceRoute>) {
  const current = await readVoiceRoute(routeId);
  if (!current) return null;
  return saveVoiceRoute({ ...current, ...patch, routeId: current.routeId });
}

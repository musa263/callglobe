import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { put, updateObject } from '../../shared/object-store.js';
import { readStoredObject } from '../../shared/stored-object-read.js';
import { requiredEnv } from '../../shared/http.js';

export type ReservedVoiceRoute = {
  routeId: string;
  userId: string;
  organizationId: string;
  destination: string;
  callerId?: string;
  carrierTrunkId?: string;
  carrierRevision?: number;
  carrierGateway?: string;
  callerName?: string;
  callerPhotoUrl?: string;
  callerExtension?: string;
  sourceExtensionId?: string;
  callerSipUsername?: string;
  destinationName?: string;
  destinationExtension?: string;
  destinationExtensionId?: string;
  flow: 'outbound' | 'internal';
  phase: 'dialing' | 'ringing' | 'connected' | 'ended' | 'failed';
  failureCause?: string;
  wakeupCallControlIds?: string[];
  connectedAt?: string;
  createdAt: string;
  expiresAt: string;
  revision?: number;
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
    const value = await readStoredObject(pathname(routeId));
    if (!value) return null;
    const route = decrypt(value);
    return new Date(route.expiresAt).getTime() > Date.now() ? route : null;
  } catch (error) {
    console.error('Vocivo could not read a voice route', {
      routeIdHash: routeHash(routeId).slice(0, 12),
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    });
    return null;
  }
}

export async function saveVoiceRoute(route: ReservedVoiceRoute) {
  const normalized = { ...route, revision: route.revision || 1 };
  await put(pathname(route.routeId), encrypt(normalized), { access: 'private', contentType: 'application/octet-stream', allowOverwrite: false });
  return normalized;
}

export async function updateVoiceRoute(routeId: string, patch: Partial<ReservedVoiceRoute>): Promise<ReservedVoiceRoute | null> {
  let updated: ReservedVoiceRoute | null = null;
  await updateObject(pathname(routeId), (value) => {
    const current = decrypt(value);
    if (new Date(current.expiresAt).getTime() <= Date.now()) return value;
    const terminal = current.phase === 'ended' || current.phase === 'failed';
    const phaseOrder: Record<ReservedVoiceRoute['phase'], number> = { dialing: 0, ringing: 1, connected: 2, ended: 3, failed: 3 };
    const regresses = patch.phase && phaseOrder[patch.phase] < phaseOrder[current.phase];
    const nextPatch = (terminal || regresses) && patch.phase && patch.phase !== current.phase
      ? { ...patch, phase: current.phase }
      : patch;
    updated = { ...current, ...nextPatch, routeId: current.routeId, revision: (current.revision || 0) + 1 };
    return encrypt(updated);
  });
  return updated;
}

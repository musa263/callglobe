import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { del, put } from './object-store.js';
import { readStoredObject } from './stored-object-read.js';
import { requiredEnv } from './http.js';

export type OutboundCallPair = {
  clientCallControlId: string;
  destinationCallControlId: string;
  routeId?: string;
  destination: string;
  status: 'direct' | 'merging' | 'conference';
  phase?: 'dialing' | 'ringing' | 'connected' | 'ended' | 'failed';
  failureCause?: string;
  connectedAt?: string;
  conferenceId?: string;
  conferenceRole?: 'host' | 'released';
  peerClientCallControlId?: string;
  peerDestinationCallControlId?: string;
  updatedAt: string;
};

function key() { return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:outbound-calls`).digest(); }
function idHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function path(kind: 'client' | 'destination' | 'route', id: string) { return `vocivo/outbound-calls/${kind}-${idHash(id)}.bin`; }
function encrypt(value: OutboundCallPair) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
function decrypt(value: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as OutboundCallPair;
}
async function readPath(pathname: string) {
  try {
    const value = await readStoredObject(pathname);
    return value ? decrypt(value) : null;
  } catch {
    return null;
  }
}

export async function saveOutboundCallPair(pair: OutboundCallPair) {
  const body = encrypt(pair);
  const paths = [
    put(path('client', pair.clientCallControlId), body, { access: 'public', contentType: 'application/octet-stream', allowOverwrite: true }),
    put(path('destination', pair.destinationCallControlId), body, { access: 'public', contentType: 'application/octet-stream', allowOverwrite: true }),
  ];
  if (pair.routeId) paths.push(put(path('route', pair.routeId), body, { access: 'public', contentType: 'application/octet-stream', allowOverwrite: true }));
  await Promise.all(paths);
}

export function readOutboundCallPairByClient(id: string) { return readPath(path('client', id)); }
export function readOutboundCallPairByDestination(id: string) { return readPath(path('destination', id)); }
export function readOutboundCallPairByRoute(id: string) { return readPath(path('route', id)); }

export async function clearOutboundCallPair(pair: OutboundCallPair) {
  const paths = [path('client', pair.clientCallControlId), path('destination', pair.destinationCallControlId)];
  if (pair.routeId) paths.push(path('route', pair.routeId));
  await del(paths);
}

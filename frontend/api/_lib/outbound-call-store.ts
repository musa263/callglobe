import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { del, list, put } from '@vercel/blob';
import { requiredEnv } from './http.js';

export type OutboundCallPair = {
  clientCallControlId: string;
  destinationCallControlId: string;
  destination: string;
  status: 'direct' | 'merging' | 'conference';
  conferenceId?: string;
  conferenceRole?: 'host' | 'released';
  peerClientCallControlId?: string;
  peerDestinationCallControlId?: string;
  updatedAt: string;
};

function key() { return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:outbound-calls`).digest(); }
function idHash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function path(kind: 'client' | 'destination', id: string) { return `vocivo/outbound-calls/${kind}-${idHash(id)}.bin`; }
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
    const result = await list({ prefix: pathname, limit: 1 });
    const blob = result.blobs[0];
    if (!blob) return null;
    const response = await fetch(blob.url);
    return response.ok ? decrypt(Buffer.from(await response.arrayBuffer())) : null;
  } catch {
    return null;
  }
}

export async function saveOutboundCallPair(pair: OutboundCallPair) {
  const body = encrypt(pair);
  await Promise.all([
    put(path('client', pair.clientCallControlId), body, { access: 'public', contentType: 'application/octet-stream', allowOverwrite: true }),
    put(path('destination', pair.destinationCallControlId), body, { access: 'public', contentType: 'application/octet-stream', allowOverwrite: true }),
  ]);
}

export function readOutboundCallPairByClient(id: string) { return readPath(path('client', id)); }
export function readOutboundCallPairByDestination(id: string) { return readPath(path('destination', id)); }

export async function clearOutboundCallPair(pair: OutboundCallPair) {
  const paths = [path('client', pair.clientCallControlId), path('destination', pair.destinationCallControlId)];
  const blobs = await Promise.all(paths.map((pathname) => list({ prefix: pathname, limit: 1 })));
  const urls = blobs.flatMap((result) => result.blobs.map((blob) => blob.url));
  if (urls.length) await del(urls);
}

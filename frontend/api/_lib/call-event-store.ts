import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { list, put, readObjects } from './object-store.js';
import { requiredEnv } from './http.js';

export type StoredCallEvent = {
  id: string;
  name: string;
  type: 'webhook';
  event_timestamp: string;
  call_session_id?: string;
  call_leg_id?: string;
  call_control_id?: string;
  direction?: string;
  from?: string;
  to?: string;
  hangup_cause?: string;
  organizationId?: string;
  flow?: string;
  routeId?: string;
  sourceExtensionId?: string;
  sourceExtension?: string;
  sourceName?: string;
  destinationExtensionId?: string;
  destinationExtension?: string;
  destinationName?: string;
};

function key() { return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:call-events`).digest(); }
function encrypt(value: StoredCallEvent) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
function decrypt(value: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as StoredCallEvent;
}

export async function storeCallEvent(event: StoredCallEvent) {
  const newestFirst = String(9_999_999_999_999 - Date.now()).padStart(13, '0');
  await put(`vocivo/call-events/v2/${newestFirst}-${event.id}.bin`, encrypt(event), { access: 'public', contentType: 'application/octet-stream', addRandomSuffix: true });
}

export async function listCallEvents(limit = 100) {
  const result = await list({ prefix: 'vocivo/call-events/v2/', limit: Math.min(Math.max(limit, 1), 250) });
  const objects = await readObjects(result.blobs.map((blob) => blob.pathname));
  const events = result.blobs.map((blob) => {
    try {
      const value = objects.get(blob.pathname);
      return value ? decrypt(value) : null;
    } catch { return null; }
  }).filter((event): event is StoredCallEvent => Boolean(event));
  return events.sort((a, b) => b.event_timestamp.localeCompare(a.event_timestamp)).slice(0, limit);
}

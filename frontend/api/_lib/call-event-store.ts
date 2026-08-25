import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { list, put } from '@vercel/blob';
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
  const events = (await Promise.all(result.blobs.map(async (blob) => {
    try {
      const response = await fetch(blob.url);
      return response.ok ? decrypt(Buffer.from(await response.arrayBuffer())) : null;
    } catch { return null; }
  }))).filter((event): event is StoredCallEvent => Boolean(event));
  return events.sort((a, b) => b.event_timestamp.localeCompare(a.event_timestamp)).slice(0, limit);
}

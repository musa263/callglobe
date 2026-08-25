import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { list, put } from '@vercel/blob';
import { requiredEnv } from './http.js';

export type StoredMessage = {
  id: string;
  to: string;
  from: string;
  text: string;
  direction: 'inbound' | 'outbound';
  status: 'sending' | 'sent' | 'received' | 'failed';
  createdAt: string;
  error?: string;
  updatedAt: string;
  organizationId?: string;
};

function key() {
  return createHash('sha256').update(requiredEnv('AUTH_SECRET')).digest();
}

function encrypt(value: StoredMessage) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function decrypt(value: Buffer): StoredMessage {
  const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as StoredMessage;
}

export async function storeMessageEvent(message: StoredMessage) {
  const newestFirst = String(9_999_999_999_999 - Date.now()).padStart(13, '0');
  await put(`vocivo/messages/v2/${newestFirst}-${message.id}.bin`, encrypt(message), { access: 'public', contentType: 'application/octet-stream', addRandomSuffix: true });
}

export async function listStoredMessages(organizationId: string) {
  const [recent, legacy] = await Promise.all([
    list({ prefix: 'vocivo/messages/v2/', limit: 1000 }),
    list({ prefix: 'vocivo/messages/', limit: 1000 }),
  ]);
  const blobs = [...new Map([...recent.blobs, ...legacy.blobs].map((blob) => [blob.url, blob])).values()];
  const events = (await Promise.all(blobs.map(async (blob) => {
    try {
      const response = await fetch(blob.url);
      if (!response.ok) return null;
      return decrypt(Buffer.from(await response.arrayBuffer()));
    } catch { return null; }
  }))).filter((item): item is StoredMessage => Boolean(item));
  const latest = new Map<string, StoredMessage>();
  events.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).forEach((event) => {
    const previous = latest.get(event.id);
    latest.set(event.id, { ...previous, ...event, text: event.text || previous?.text || '', to: event.to || previous?.to || '', from: event.from || previous?.from || '' });
  });
  return [...latest.values()]
    .filter((item) => (item.organizationId || 'primary') === organizationId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
}

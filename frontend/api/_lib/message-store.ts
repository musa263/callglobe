import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { list, put, readObject } from './object-store.js';
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
  transport?: 'sms' | 'internal';
  senderExtensionId?: string;
  senderExtension?: string;
  senderName?: string;
  recipientExtensionId?: string;
  recipientExtension?: string;
  recipientName?: string;
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

export function messageForViewer(item: StoredMessage, viewerExtensionId?: string) {
  if (item.transport !== 'internal') return { ...item, transport: 'sms' as const };
  if (!viewerExtensionId || ![item.senderExtensionId, item.recipientExtensionId].includes(viewerExtensionId)) return null;
  const outbound = item.senderExtensionId === viewerExtensionId;
  return {
    ...item,
    direction: outbound ? 'outbound' as const : 'inbound' as const,
    to: `extension:${item.recipientExtension || ''}`,
    from: `extension:${item.senderExtension || ''}`,
    contactName: outbound ? item.recipientName : item.senderName,
  };
}

export async function listStoredMessages(organizationId: string, viewerExtensionId?: string) {
  const [recent, legacy] = await Promise.all([
    list({ prefix: 'vocivo/messages/v2/', limit: 1000 }),
    list({ prefix: 'vocivo/messages/', limit: 1000 }),
  ]);
  const blobs = [...new Map([...recent.blobs, ...legacy.blobs].map((blob) => [blob.url, blob])).values()];
  const events = (await Promise.all(blobs.map(async (blob) => {
    try {
      const value = await readObject(blob.pathname);
      return value ? decrypt(value) : null;
    } catch { return null; }
  }))).filter((item): item is StoredMessage => Boolean(item));
  const latest = new Map<string, StoredMessage>();
  events.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).forEach((event) => {
    const previous = latest.get(event.id);
    latest.set(event.id, { ...previous, ...event, text: event.text || previous?.text || '', to: event.to || previous?.to || '', from: event.from || previous?.from || '' });
  });
  return [...latest.values()]
    .filter((item) => (item.organizationId || 'primary') === organizationId)
    .map((item) => messageForViewer(item, viewerExtensionId))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
}

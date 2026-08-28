import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { list, put, putMany, readObjects } from './object-store.js';
import { requiredEnv } from './http.js';
import { hasMigrationMarker, listAllStoredPaths, newestFirstTimestamp, overwriteEntries, saveMigrationMarker, tenantStorageKey } from './tenant-storage.js';

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
  organizationId: string;
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
  const organizationId = message.organizationId.trim();
  if (!organizationId) throw new Error('A tenant organization is required before storing a message.');
  const newestFirst = newestFirstTimestamp(message.updatedAt || message.createdAt);
  const messageKey = createHash('sha256').update(`${message.id}:${message.updatedAt}`).digest('hex').slice(0, 20);
  await put(`vocivo/messages/v3/${tenantStorageKey(organizationId)}/${newestFirst}-${messageKey}.bin`, encrypt({ ...message, organizationId }), { access: 'private', contentType: 'application/octet-stream', allowOverwrite: true });
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
  const tenantKey = tenantStorageKey(organizationId);
  const marker = `vocivo/migrations/messages-v3/${tenantKey}.marker`;
  if (!await hasMigrationMarker(marker)) {
    const legacyPaths = [...new Set([
      ...await listAllStoredPaths('vocivo/messages/v2/'),
      ...await listAllStoredPaths('vocivo/messages/', 10_000),
    ].filter((pathname) => !pathname.startsWith('vocivo/messages/v3/')))];
    const legacyObjects = await readObjects(legacyPaths);
    const tenantEvents = legacyPaths.map((pathname) => {
      try { const value = legacyObjects.get(pathname); return value ? decrypt(value) : null; } catch { return null; }
    }).filter((item): item is StoredMessage => item !== null && item.organizationId === organizationId);
    if (tenantEvents.length) {
      await putMany(overwriteEntries(tenantEvents.map((message) => ({
        pathname: `vocivo/messages/v3/${tenantKey}/${newestFirstTimestamp(message.updatedAt || message.createdAt)}-${createHash('sha256').update(`${message.id}:${message.updatedAt}`).digest('hex').slice(0, 20)}.bin`,
        value: encrypt({ ...message, organizationId }),
      }))));
    }
    await saveMigrationMarker(marker);
  }
  const recent = await list({ prefix: `vocivo/messages/v3/${tenantKey}/`, limit: 1000 });
  const blobs = recent.blobs;
  const objects = await readObjects(blobs.map((blob) => blob.pathname));
  const events = blobs.map((blob) => {
    try {
      const value = objects.get(blob.pathname);
      return value ? decrypt(value) : null;
    } catch { return null; }
  }).filter((item): item is StoredMessage => Boolean(item));
  const latest = new Map<string, StoredMessage>();
  events.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).forEach((event) => {
    const previous = latest.get(event.id);
    latest.set(event.id, { ...previous, ...event, text: event.text || previous?.text || '', to: event.to || previous?.to || '', from: event.from || previous?.from || '' });
  });
  return [...latest.values()]
    .filter((item) => item.organizationId === organizationId)
    .map((item) => messageForViewer(item, viewerExtensionId))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
}

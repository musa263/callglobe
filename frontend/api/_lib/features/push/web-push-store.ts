import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { del, list, put, readObjects } from '../../shared/object-store.js';
import { requiredEnv } from '../../shared/http.js';
import { tenantStorageKey } from '../../shared/tenant-storage.js';

export type WebPushSubscriptionRecord = {
  id: string;
  organizationId: string;
  extensionId: string;
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
  updatedAt: string;
};

function encryptionKey() {
  return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:web-push`).digest();
}

function encrypt(value: WebPushSubscriptionRecord) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function decrypt(value: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as WebPushSubscriptionRecord;
}

function safeId(value: string) {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 100);
  if (!normalized) throw new Error('A web push subscription ID is required.');
  return normalized;
}

function prefix(organizationId: string, extensionId: string) {
  return `vocivo/web-push/v1/${tenantStorageKey(organizationId)}/${safeId(extensionId)}/`;
}

function pathname(record: Pick<WebPushSubscriptionRecord, 'organizationId' | 'extensionId' | 'id'>) {
  return `${prefix(record.organizationId, record.extensionId)}${safeId(record.id)}.bin`;
}

export function webPushSubscriptionId(endpoint: string) {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 40);
}

export async function saveWebPushSubscription(record: WebPushSubscriptionRecord) {
  await put(pathname(record), encrypt(record), { access: 'private', contentType: 'application/octet-stream', allowOverwrite: true });
}

export async function deleteWebPushSubscription(record: Pick<WebPushSubscriptionRecord, 'organizationId' | 'extensionId' | 'id'>) {
  await del(pathname(record));
}

export async function listWebPushSubscriptions(organizationId: string, extensionId: string) {
  const result = await list({ prefix: prefix(organizationId, extensionId), limit: 100 });
  const objects = await readObjects(result.blobs.map((blob) => blob.pathname));
  const staleBefore = Date.now() - 45 * 24 * 60 * 60 * 1000;
  return result.blobs.flatMap((blob) => {
    try {
      const encrypted = objects.get(blob.pathname);
      const record = encrypted ? decrypt(encrypted) : null;
      return record && new Date(record.updatedAt).getTime() >= staleBefore ? [record] : [];
    } catch (error) {
      console.warn('Vocivo ignored an unreadable web push subscription', { pathname: blob.pathname, error });
      return [];
    }
  });
}

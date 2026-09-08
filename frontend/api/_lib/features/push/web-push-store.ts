import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createOwnedPushStore, type PushStorage } from './push-ownership-store.js';
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

export function createWebPushStore(deps?: PushStorage) {
  return createOwnedPushStore<WebPushSubscriptionRecord>({
    root: 'vocivo/web-push/v1/', scope: prefix, pathname, encrypt, decrypt,
    destination: record => record.endpoint,
  }, deps);
}

const subscriptions = createWebPushStore();
export const saveWebPushSubscription = subscriptions.save;
export const listWebPushSubscriptions = subscriptions.list;
export const deleteWebPushSubscription = subscriptions.remove;

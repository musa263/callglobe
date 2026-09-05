import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { del, list, put, readObjects } from '../../shared/object-store.js';
import { requiredEnv } from '../../shared/http.js';
import { tenantStorageKey } from '../../shared/tenant-storage.js';

export type PushDevice = {
  id: string;
  extensionId: string;
  extension: string;
  organizationId: string;
  platform: 'ios' | 'android';
  token: string;
  environment: 'production' | 'sandbox';
  bundleId?: string;
  appVersion?: string;
  updatedAt: string;
};

function encryptionKey() {
  return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:push-devices`).digest();
}

function encrypt(value: PushDevice) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function decrypt(value: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as PushDevice;
}

function safeId(value: string) {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]/g, '').slice(0, 100);
  if (!normalized) throw new Error('A device ID is required.');
  return normalized;
}

function prefix(organizationId: string, extensionId: string) {
  return `vocivo/push-devices/v1/${tenantStorageKey(organizationId)}/${safeId(extensionId)}/`;
}

function pathname(device: Pick<PushDevice, 'organizationId' | 'extensionId' | 'id'>) {
  return `${prefix(device.organizationId, device.extensionId)}${safeId(device.id)}.bin`;
}

export async function savePushDevice(device: PushDevice) {
  await put(pathname(device), encrypt(device), { access: 'private', contentType: 'application/octet-stream', allowOverwrite: true });
}

export async function deletePushDevice(input: Pick<PushDevice, 'organizationId' | 'extensionId' | 'id'>) {
  await del(pathname(input));
}

export async function listPushDevices(organizationId: string, extensionId: string) {
  const result = await list({ prefix: prefix(organizationId, extensionId), limit: 100 });
  const objects = await readObjects(result.blobs.map((blob) => blob.pathname));
  const staleBefore = Date.now() - 45 * 24 * 60 * 60 * 1000;
  const devices = result.blobs.flatMap((blob) => {
    try {
      const value = objects.get(blob.pathname);
      const device = value ? decrypt(value) : null;
      return device && new Date(device.updatedAt).getTime() >= staleBefore ? [device] : [];
    } catch {
      return [];
    }
  });
  return [...new Map(devices.map((device) => [`${device.platform}:${device.token}`, device])).values()];
}

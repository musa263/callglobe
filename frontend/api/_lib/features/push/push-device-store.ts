import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createOwnedPushStore, type PushStorage } from './push-ownership-store.js';
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

export function createPushDeviceStore(deps?: PushStorage) {
  return createOwnedPushStore<PushDevice>({
    root: 'vocivo/push-devices/v1/', scope: prefix, pathname, encrypt, decrypt,
    destination: device => JSON.stringify(device.platform === 'ios'
      ? ['ios', device.environment, (device.bundleId || 'app.vocivo.mobile').replace(/\.voip$/i, ''), device.token.toLowerCase()]
      : ['android', device.token]),
  }, deps);
}

const devices = createPushDeviceStore();
export const savePushDevice = devices.save;
export const listPushDevices = devices.list;
export const deletePushDevice = devices.remove;

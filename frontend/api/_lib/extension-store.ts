import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { del, put, readObject } from './object-store.js';
import { requiredEnv } from './http.js';
import type { ExtensionUser } from './pbx.js';

type StoredExtensionDirectory = {
  version: 1;
  syncedAt: string;
  extensions: ExtensionUser[];
};

export type StoredExtensionCredential = {
  version: 1 | 2 | 3;
  syncedAt: string;
  extension: ExtensionUser;
  sipUsername: string;
  sipPassword: string;
  provider?: 'telnyx' | 'freeswitch';
  sipDomain?: string;
  carrierCredentialId?: string;
};

const directoryPath = 'vocivo/pbx/extensions/v1/directory.bin';

function encryptionKey() {
  return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:extension-store:v1`).digest();
}

function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function decrypt<T>(value: Buffer): T {
  if (value.length < 29) throw new Error('Stored extension data is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as T;
}

function credentialPath(id: string) {
  const key = createHash('sha256').update(id).digest('hex');
  return `vocivo/pbx/extensions/v1/credentials/${key}.bin`;
}

export async function readExtensionDirectory() {
  const value = await readObject(directoryPath);
  if (!value) return null;
  try {
    const stored = decrypt<StoredExtensionDirectory>(value);
    return stored.version === 1 && Array.isArray(stored.extensions) ? stored.extensions : null;
  } catch {
    return null;
  }
}

export async function saveExtensionDirectory(extensions: ExtensionUser[]) {
  const stored: StoredExtensionDirectory = {
    version: 1,
    syncedAt: new Date().toISOString(),
    extensions: extensions.map((extension) => ({ ...extension })),
  };
  await put(directoryPath, encrypt(stored), {
    access: 'private',
    contentType: 'application/octet-stream',
    allowOverwrite: true,
  });
}

export async function readExtensionCredential(id: string) {
  const value = await readObject(credentialPath(id));
  if (!value) return null;
  try {
    const stored = decrypt<StoredExtensionCredential>(value);
    return [1, 2, 3].includes(stored.version) && stored.extension?.id === id
      ? { ...stored, provider: stored.provider || 'telnyx' }
      : null;
  } catch {
    return null;
  }
}

export async function saveExtensionCredential(input: Omit<StoredExtensionCredential, 'version' | 'syncedAt'>) {
  const stored: StoredExtensionCredential = {
    version: 3,
    syncedAt: new Date().toISOString(),
    ...input,
  };
  await put(credentialPath(input.extension.id), encrypt(stored), {
    access: 'private',
    contentType: 'application/octet-stream',
    allowOverwrite: true,
  });
  return stored;
}

export async function deleteExtensionCredential(id: string) {
  await del(credentialPath(id));
}

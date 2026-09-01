import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { put } from './object-store.js';
import { readStoredObject } from './stored-object-read.js';
import { requiredEnv } from './http.js';

export type StoredSipCredential = {
  username: string;
  extensionId: string;
  organizationId: string;
  realm: string;
  ha1: string;
  expiresAt: string;
};

function key() {
  return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:sip-credentials`).digest();
}

function pathname(username: string) {
  const hash = createHash('sha256').update(username.trim().toLowerCase()).digest('hex');
  return `vocivo/sip-credentials/${hash}.bin`;
}

function encrypt(value: StoredSipCredential) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function decrypt(value: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as StoredSipCredential;
}

export async function saveSipCredential(credential: StoredSipCredential) {
  await put(pathname(credential.username), encrypt(credential), {
    access: 'private',
    contentType: 'application/octet-stream',
    allowOverwrite: true,
  });
}

export async function readSipCredential(username: string) {
  const value = await readStoredObject(pathname(username));
  if (!value) return null;
  try {
    const credential = decrypt(value);
    if (new Date(credential.expiresAt).getTime() <= Date.now()) return null;
    return credential;
  } catch {
    return null;
  }
}

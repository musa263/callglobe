import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { requiredEnv } from './http.js';
import { readObject, transactObject } from './object-store.js';

/**
 * The platform owner's password hash, encrypted in Vocivo's own store.
 *
 * It used to live in a tag on a Telnyx phone number — `vopwd_<base64 of the
 * bcrypt hash>` — which put the credential that signs in to the whole platform
 * inside a carrier resource that tenant administrators can both read and
 * rewrite through the numbers screen. Reading it offered the hash for offline
 * cracking; rewriting it set the owner's password to one of their choosing.
 *
 * The tag is still read, once, for an installation written before this store
 * existed, and the next password change moves it here for good.
 */

const pathname = 'vocivo/auth/owner.bin';

type StoredCredential = { hash: string; updatedAt: string };

function key() {
  return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:owner-credential:v1`).digest();
}

function encrypt(value: StoredCredential) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function decrypt(value: Buffer): StoredCredential | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12));
    decipher.setAuthTag(value.subarray(12, 28));
    const decoded = JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as StoredCredential;
    return typeof decoded?.hash === 'string' && decoded.hash ? decoded : null;
  } catch {
    return null;
  }
}

/** The stored hash, or null when the owner's password has never been changed here. */
export async function readStoredOwnerPasswordHash() {
  const stored = await readObject(pathname).catch(() => null);
  return stored ? decrypt(stored)?.hash || null : null;
}

export async function writeOwnerPasswordHash(hash: string) {
  if (!hash) throw new Error('An owner password hash is required.');
  await transactObject(pathname, () => encrypt({ hash, updatedAt: new Date().toISOString() }), {
    access: 'private',
    contentType: 'application/octet-stream',
  });
}

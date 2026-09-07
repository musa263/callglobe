import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { requiredEnv } from '../../shared/http.js';
import { put, readObject, transactObject, type PutOptions } from '../../shared/object-store.js';

/**
 * The platform owner's password hash, encrypted in Vocivo's own store.
 *
 * It used to live in a tag on a Telnyx phone number — `vopwd_<base64 of the
 * bcrypt hash>` — which put the credential that signs in to the whole platform
 * inside a carrier resource that tenant administrators can both read and
 * rewrite through the numbers screen. Reading it offered the hash for offline
 * cracking; rewriting it set the owner's password to one of their choosing.
 *
 * Legacy installations must migrate their existing hash before deploying the
 * carrier-independent login. The runtime never reads carrier password tags.
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
    throw new Error('Stored owner credential could not be decrypted.');
  }
}

/** The stored hash, or null when the owner's password has never been changed here. */
export async function readStoredOwnerPasswordHash(read: (pathname: string) => Promise<Buffer | null> = readObject) {
  const stored = await read(pathname);
  if (!stored) return null;
  const hash = decrypt(stored)?.hash;
  if (!hash) throw new Error('Stored owner credential is invalid.');
  return hash;
}

export async function writeOwnerPasswordHash(hash: string) {
  if (!hash) throw new Error('An owner password hash is required.');
  await transactObject(pathname, () => encrypt({ hash, updatedAt: new Date().toISOString() }), {
    access: 'private',
    contentType: 'application/octet-stream',
  });
}

/** One-time import: never replace a password already changed in the new store. */
export async function initializeOwnerPasswordHash(hash: string, create: (pathname: string, body: Buffer, options: PutOptions) => Promise<unknown> = put) {
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) throw new Error('A valid bcrypt hash is required.');
  await create(pathname, encrypt({ hash, updatedAt: new Date().toISOString() }), {
    access: 'private', contentType: 'application/octet-stream', allowOverwrite: false,
  });
}

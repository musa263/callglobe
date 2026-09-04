import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { transactObject } from './object-store.js';
import { readStoredObject } from './stored-object-read.js';
import { requiredEnv } from './http.js';

export type StoredSipCredential = {
  username: string;
  extensionId: string;
  organizationId: string;
  realm: string;
  ha1: string;
  expiresAt: string;
  /**
   * Which of this person's phones the password was issued to — their browser,
   * their handset. One extension is signed in on more than one at a time, and
   * a single stored credential meant the second sign-in silently took the
   * first one's phone off the registrar.
   */
  client?: string;
  issuedAt?: string;
};

/** How many of a person's devices may hold a live password at once. */
const maximumCredentials = 6;

function key() {
  return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:sip-credentials`).digest();
}

function pathname(username: string) {
  const hash = createHash('sha256').update(username.trim().toLowerCase()).digest('hex');
  return `vocivo/sip-credentials/${hash}.bin`;
}

function encrypt(value: StoredSipCredential[]) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ credentials: value })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** Reads either shape: the list written now, or the single credential written before. */
function decrypt(value: Buffer): StoredSipCredential[] {
  const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  const decoded = JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as
    StoredSipCredential | { credentials?: StoredSipCredential[] };
  const list = Array.isArray((decoded as { credentials?: StoredSipCredential[] }).credentials)
    ? (decoded as { credentials: StoredSipCredential[] }).credentials
    : [decoded as StoredSipCredential];
  return list.filter((credential) => credential && typeof credential.ha1 === 'string' && credential.ha1);
}

export function liveSipCredentials(credentials: StoredSipCredential[], now = Date.now()) {
  return credentials.filter((credential) => new Date(credential.expiresAt).getTime() > now);
}
const live = liveSipCredentials;

/**
 * The list to store once this device has a new password: the expired ones are
 * dropped, this device's previous one is replaced rather than added to, and
 * the oldest goes if the person has more phones than we keep passwords for.
 */
export function mergeSipCredentials(existing: StoredSipCredential[], credential: StoredSipCredential, now = Date.now()) {
  const slot = credential.client || '';
  const kept = live(existing, now).filter((item) => (item.client || '') !== slot);
  return [...kept, credential].slice(-maximumCredentials);
}

export async function saveSipCredential(credential: StoredSipCredential) {
  // Read-modify-write under the store's own lock: a browser and a handset that
  // ask at the same moment must not each write a file holding only their own.
  await transactObject(pathname(credential.username), (current) => {
    let existing: StoredSipCredential[] = [];
    if (current) {
      try {
        existing = decrypt(current);
      } catch {
        existing = [];
      }
    }
    return encrypt(mergeSipCredentials(existing, credential));
  }, { access: 'private', contentType: 'application/octet-stream' });
}

/** Every password that is still valid for this SIP username. */
export async function readSipCredentials(username: string) {
  const value = await readStoredObject(pathname(username));
  if (!value) return [];
  try {
    return live(decrypt(value));
  } catch {
    return [];
  }
}

/** The most recently issued live password, for callers that want just one. */
export async function readSipCredential(username: string) {
  const credentials = await readSipCredentials(username);
  return credentials.length ? credentials[credentials.length - 1] : null;
}

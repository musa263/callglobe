import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { del, put, readObject, transactObject } from '../../shared/object-store.js';
import { requiredEnv } from '../../shared/http.js';
import type { ExtensionUser } from './pbx.js';

import { adoptVocivoExtensions, decodeExtensionDirectory, type ExtensionAuthority, type ExtensionDirectory } from './extension-directory.js';

export type StoredExtensionCredential = {
  version: 1 | 2 | 3;
  syncedAt: string;
  extension: ExtensionUser;
  sipUsername: string;
  sipPassword: string;
  provider: 'telnyx';
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

export async function readExtensionDirectoryState(read: (pathname: string) => Promise<Buffer | null> = readObject) {
  const value = await read(directoryPath);
  return value ? decodeExtensionDirectory(decrypt<unknown>(value)) : null;
}

export async function readExtensionDirectory() {
  return (await readExtensionDirectoryState())?.extensions ?? null;
}

/** Explicit, atomic adoption. No carrier reads, password rotation or identity remapping. */
export async function adoptExtensionDirectory(options: { initializeEmpty?: boolean; expectedRevision?: number } = {}, transaction = transactObject) {
  const result = await transaction(directoryPath, async (current) => {
    if (!current && !options.initializeEmpty) throw new Error('Extension directory is missing; import existing accounts before migration.');
    const stored = current ? decodeExtensionDirectory(decrypt<unknown>(current)) : null;
    if (stored?.authority === 'vocivo') return current!;
    if (options.expectedRevision !== undefined && Number(stored?.revision || 0) !== options.expectedRevision) {
      throw new Error('Extension directory changed during migration; run the check again.');
    }
    const next: ExtensionDirectory = {
      version: 3, authority: 'vocivo', revision: Number(stored?.revision || 0) + 1,
      syncedAt: new Date().toISOString(), extensions: adoptVocivoExtensions(stored?.extensions || []),
    };
    return encrypt(next);
  }, { access: 'private', contentType: 'application/octet-stream' });
  return decodeExtensionDirectory(decrypt<unknown>(result.body));
}

export async function saveExtensionDirectory(extensions: ExtensionUser[]) {
  // Seed-only write: never overwrite a directory that concurrent writers already populated.
  return updateExtensionDirectory((current) => (current.length ? current : extensions), undefined, 'telnyx');
}

export async function updateExtensionDirectory(update: (extensions: ExtensionUser[]) => ExtensionUser[] | Promise<ExtensionUser[]>, transaction: typeof transactObject = transactObject, expectedAuthority?: ExtensionAuthority) {
  const result = await transaction(directoryPath, async (current) => {
    let extensions: ExtensionUser[] = [];
    let revision = 0;
    let authority: ExtensionAuthority = 'telnyx';
    if (current) {
      const stored = decodeExtensionDirectory(decrypt<unknown>(current));
      authority = stored.authority || 'telnyx';
      extensions = stored.extensions;
      revision = Number(stored.revision || 0);
    }
    if (expectedAuthority && authority !== expectedAuthority) throw new Error('Extension authority changed; reload before saving.');
    const next: ExtensionDirectory = {
      version: authority === 'vocivo' ? 3 : 2,
      ...(authority === 'vocivo' ? { authority } : {}),
      revision: revision + 1,
      syncedAt: new Date().toISOString(),
      extensions: (await update(extensions)).map((extension) => ({ ...extension })),
    };
    decodeExtensionDirectory(next);
    return encrypt(next);
  }, { access: 'private', contentType: 'application/octet-stream' });
  const stored = decodeExtensionDirectory(decrypt<unknown>(result.body));
  if (!stored.revision) throw new Error('Extension directory compare-and-swap failed.');
  return stored.extensions;
}

export async function readExtensionCredential(id: string) {
  const value = await readObject(credentialPath(id));
  if (!value) return null;
  try {
    const stored = decrypt<StoredExtensionCredential>(value);
    if (![1, 2, 3].includes(stored.version) || stored.extension?.id !== id) return null;
    if (stored.provider && stored.provider !== 'telnyx') return null;
    if (stored.extension.sipProvider && stored.extension.sipProvider !== 'telnyx') return null;
    return {
      ...stored,
      provider: 'telnyx' as const,
      extension: { ...stored.extension, sipProvider: 'telnyx' as const },
    };
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

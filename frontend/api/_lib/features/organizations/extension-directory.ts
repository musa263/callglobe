import type { ExtensionUser } from './pbx.js';

export type ExtensionAuthority = 'telnyx' | 'vocivo';
export type ExtensionDirectory = {
  version: 1 | 2 | 3;
  revision?: number;
  authority?: ExtensionAuthority;
  syncedAt: string;
  extensions: ExtensionUser[];
};

/** Validate before adopting a directory; never invent or reassign a legacy identity. */
export function validateVocivoExtensions(extensions: ExtensionUser[]) {
  const ids = new Set<string>();
  const usernames = new Set<string>();
  const numbers = new Set<string>();
  for (const item of extensions) {
    if (!item || typeof item.id !== 'string' || !item.id.trim()
      || typeof item.organizationId !== 'string' || !item.organizationId.trim()
      || typeof item.extension !== 'string' || !/^\d{2,5}$/.test(item.extension)
      || typeof item.sipUsername !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(item.sipUsername)
      || !['active', 'expired'].includes(item.status)
      || !['company_owner', 'company_admin', 'manager', 'user', 'individual'].includes(item.role)
      || !['name', 'email', 'mobile', 'department'].every((key) => typeof item[key as keyof ExtensionUser] === 'string')
      || (item.sipProvider !== undefined && !['telnyx', 'vocivo'].includes(item.sipProvider))) {
      throw new Error('Extension directory contains an invalid identity; migration refused.');
    }
    const number = JSON.stringify([item.organizationId, item.extension]);
    if (ids.has(item.id) || usernames.has(item.sipUsername) || numbers.has(number)) {
      throw new Error('Extension directory contains duplicate identities; migration refused.');
    }
    ids.add(item.id); usernames.add(item.sipUsername); numbers.add(number);
  }
}

export function decodeExtensionDirectory(value: unknown): ExtensionDirectory {
  const stored = value as ExtensionDirectory | null;
  if (!stored || ![1, 2, 3].includes(stored.version) || !Array.isArray(stored.extensions)
    || (stored.version === 3 && stored.authority !== 'vocivo')
    || (stored.version === 3 && (!Number.isSafeInteger(stored.revision) || Number(stored.revision) < 1))
    || (stored.revision !== undefined && (!Number.isSafeInteger(stored.revision) || stored.revision < 0))
    || (stored.version !== 3 && stored.authority && stored.authority !== 'telnyx')) {
    throw new Error('Stored extension directory is invalid; access refused.');
  }
  if (stored.version === 3) {
    validateVocivoExtensions(stored.extensions);
    if (stored.extensions.some((item) => item.sipProvider !== 'vocivo')) throw new Error('Stored extension authority is inconsistent.');
  }
  return stored;
}

export function adoptVocivoExtensions(extensions: ExtensionUser[]) {
  validateVocivoExtensions(extensions);
  return extensions.map((item): ExtensionUser => ({ ...item, sipProvider: 'vocivo' }));
}

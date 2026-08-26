import { createHash } from 'node:crypto';
import { put } from './object-store.js';
import { readStoredObject } from './stored-object-read.js';

const cache = new Map<string, { revokedAt: number; checkedAt: number }>();
function idHash(id: string) { return createHash('sha256').update(id).digest('hex'); }
function pathname(id: string) { return `vocivo/session-revocations/${idHash(id)}.txt`; }

export async function revokeExtensionSessions(extensionId: string) {
  const revokedAt = Date.now();
  await put(pathname(extensionId), String(revokedAt), { access: 'public', contentType: 'text/plain', allowOverwrite: true });
  cache.set(extensionId, { revokedAt, checkedAt: Date.now() });
}

export async function isExtensionSessionRevoked(extensionId: string, issuedAtSeconds: number) {
  const cached = cache.get(extensionId);
  if (cached && Date.now() - cached.checkedAt < 15_000) return cached.revokedAt > issuedAtSeconds * 1000;
  try {
    const value = await readStoredObject(pathname(extensionId));
    const revokedAt = value ? Number(value.toString('utf8')) || 0 : 0;
    cache.set(extensionId, { revokedAt, checkedAt: Date.now() });
    return revokedAt > issuedAtSeconds * 1000;
  } catch {
    return false;
  }
}

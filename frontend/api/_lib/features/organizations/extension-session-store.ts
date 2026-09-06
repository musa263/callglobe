import { createHash } from 'node:crypto';
import { put } from '../../shared/object-store.js';
import { readStoredObject } from '../../shared/stored-object-read.js';

const cache = new Map<string, { revokedAt: number; checkedAt: number }>();
function idHash(id: string) { return createHash('sha256').update(id).digest('hex'); }
function pathname(id: string) { return `vocivo/session-revocations/${idHash(id)}.txt`; }

export async function revokeExtensionSessions(extensionId: string) {
  const revokedAt = Date.now();
  await put(pathname(extensionId), String(revokedAt), { access: 'private', contentType: 'text/plain', allowOverwrite: true });
  cache.set(extensionId, { revokedAt, checkedAt: Date.now() });
}

export async function isExtensionSessionRevoked(extensionId: string, issuedAtSeconds: number, options: { fresh?: boolean } = {}) {
  const cached = cache.get(extensionId);
  if (!options.fresh && cached && Date.now() - cached.checkedAt < 5_000) return cached.revokedAt > issuedAtSeconds * 1000;
  try {
    const value = await readStoredObject(pathname(extensionId));
    const revokedAt = value ? Number(value.toString('utf8')) || 0 : 0;
    cache.set(extensionId, { revokedAt, checkedAt: Date.now() });
    return revokedAt > issuedAtSeconds * 1000;
  } catch (error) {
    if (!options.fresh && cached) return cached.revokedAt > issuedAtSeconds * 1000;
    console.error('Vocivo could not read extension session revocation state', error);
    return true;
  }
}

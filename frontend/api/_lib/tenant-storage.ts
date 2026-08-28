import { createHash } from 'node:crypto';
import { list, put, readObject, type PutEntry } from './object-store.js';

export function tenantStorageKey(organizationId: string) {
  const tenant = organizationId.trim();
  if (!tenant) throw new Error('A tenant organization is required.');
  return createHash('sha256').update(tenant).digest('hex').slice(0, 24);
}

export function newestFirstTimestamp(value: string | number | Date = Date.now()) {
  const timestamp = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : new Date(value).getTime();
  return String(9_999_999_999_999 - (Number.isFinite(timestamp) ? timestamp : Date.now())).padStart(13, '0');
}

export async function listAllStoredPaths(prefix: string, maximum = 10_000) {
  const paths: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, limit: Math.min(1000, maximum - paths.length), cursor });
    paths.push(...page.blobs.map((blob) => blob.pathname));
    cursor = page.hasMore && paths.length < maximum ? page.cursor : undefined;
  } while (cursor && paths.length < maximum);
  return paths;
}

export async function hasMigrationMarker(pathname: string) {
  return Boolean(await readObject(pathname));
}

export async function saveMigrationMarker(pathname: string) {
  await put(pathname, Buffer.from('1'), { access: 'private', contentType: 'application/octet-stream', allowOverwrite: true });
}

export function overwriteEntries(entries: Array<Omit<PutEntry, 'options'>>): PutEntry[] {
  return entries.map((entry) => ({ ...entry, options: { access: 'private', contentType: 'application/octet-stream', allowOverwrite: true } }));
}

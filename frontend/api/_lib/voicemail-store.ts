import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { del, get, list, put, putMany, readObjects } from './object-store.js';
import { requiredEnv } from './http.js';
import { hasMigrationMarker, listAllStoredPaths, newestFirstTimestamp, overwriteEntries, saveMigrationMarker, tenantStorageKey } from './tenant-storage.js';

export type StoredVoicemail = {
  id: string;
  recordingId: string;
  callerNumber: string;
  callerName?: string;
  recordingPath: string;
  durationSeconds?: number;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
  organizationId: string;
};

function key() {
  return createHash('sha256').update(requiredEnv('AUTH_SECRET')).digest();
}

function encrypt(value: StoredVoicemail) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function decrypt(value: Buffer): StoredVoicemail {
  const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as StoredVoicemail;
}

export async function storeVoicemail(voicemail: StoredVoicemail) {
  const organizationId = voicemail.organizationId.trim();
  if (!organizationId) throw new Error('A tenant organization is required before storing voicemail.');
  const newestFirst = newestFirstTimestamp(voicemail.updatedAt || voicemail.createdAt);
  const voicemailKey = createHash('sha256').update(`${voicemail.id}:${voicemail.updatedAt}`).digest('hex').slice(0, 20);
  await put(`vocivo/voicemails/v3/${tenantStorageKey(organizationId)}/${newestFirst}-${voicemailKey}.bin`, encrypt({ ...voicemail, organizationId }), {
    access: 'private',
    contentType: 'application/octet-stream',
    allowOverwrite: true,
  });
}

export async function storeVoicemailAudio(id: string, sourceUrl: string) {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error('Unable to download the Telnyx voicemail recording.');
  const audio = Buffer.from(await response.arrayBuffer());
  const blob = await put(`vocivo/voicemail-audio/${id}.mp3`, audio, {
    access: 'private',
    contentType: 'audio/mpeg',
    addRandomSuffix: true,
  });
  return blob.pathname;
}

export async function readVoicemailAudio(pathname: string) {
  return get(pathname, { access: 'private' });
}

export async function listVoicemails(organizationId: string) {
  const tenantKey = tenantStorageKey(organizationId);
  const marker = `vocivo/migrations/voicemails-v3/${tenantKey}.marker`;
  if (!await hasMigrationMarker(marker)) {
    const legacyPaths = [...new Set([
      ...await listAllStoredPaths('vocivo/voicemails/v2/'),
      ...await listAllStoredPaths('vocivo/voicemails/', 10_000),
    ].filter((pathname) => !pathname.startsWith('vocivo/voicemails/v3/')))];
    const legacyObjects = await readObjects(legacyPaths);
    const tenantEvents = legacyPaths.map((pathname) => {
      try { const value = legacyObjects.get(pathname); return value ? decrypt(value) : null; } catch { return null; }
    }).filter((item): item is StoredVoicemail => item !== null && item.organizationId === organizationId);
    if (tenantEvents.length) {
      await putMany(overwriteEntries(tenantEvents.map((voicemail) => ({
        pathname: `vocivo/voicemails/v3/${tenantKey}/${newestFirstTimestamp(voicemail.updatedAt || voicemail.createdAt)}-${createHash('sha256').update(`${voicemail.id}:${voicemail.updatedAt}`).digest('hex').slice(0, 20)}.bin`,
        value: encrypt({ ...voicemail, organizationId }),
      }))));
    }
    await saveMigrationMarker(marker);
  }
  const recent = await list({ prefix: `vocivo/voicemails/v3/${tenantKey}/`, limit: 1000 });
  const blobs = recent.blobs;
  const objects = await readObjects(blobs.map((blob) => blob.pathname));
  const events = blobs.map((blob) => {
    try {
      const value = objects.get(blob.pathname);
      return value ? decrypt(value) : null;
    } catch { return null; }
  }).filter((item): item is StoredVoicemail => Boolean(item));
  const latest = new Map<string, StoredVoicemail>();
  events.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).forEach((event) => latest.set(event.id, { ...latest.get(event.id), ...event }));
  return [...latest.values()].filter((item) => !item.deleted && item.organizationId === organizationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}

export async function deleteVoicemail(id: string, organizationId: string) {
  const existing = (await listVoicemails(organizationId)).find((item) => item.id === id);
  if (!existing) return false;
  await del(existing.recordingPath).catch(() => undefined);
  await storeVoicemail({ ...existing, deleted: true, updatedAt: new Date().toISOString() });
  return true;
}

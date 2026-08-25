import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { get, list, put } from '@vercel/blob';
import { requiredEnv } from './http.js';

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
  await put(`vocivo/voicemails/${voicemail.id}-${Date.now()}.bin`, encrypt(voicemail), {
    access: 'public',
    contentType: 'application/octet-stream',
    addRandomSuffix: true,
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

export async function listVoicemails() {
  const result = await list({ prefix: 'vocivo/voicemails/', limit: 1000 });
  const events = (await Promise.all(result.blobs.map(async (blob) => {
    try {
      const response = await fetch(blob.url);
      return response.ok ? decrypt(Buffer.from(await response.arrayBuffer())) : null;
    } catch { return null; }
  }))).filter((item): item is StoredVoicemail => Boolean(item));
  const latest = new Map<string, StoredVoicemail>();
  events.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).forEach((event) => latest.set(event.id, { ...latest.get(event.id), ...event }));
  return [...latest.values()].filter((item) => !item.deleted).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}

export async function deleteVoicemail(id: string) {
  const existing = (await listVoicemails()).find((item) => item.id === id);
  if (!existing) return false;
  await storeVoicemail({ ...existing, deleted: true, updatedAt: new Date().toISOString() });
  return true;
}

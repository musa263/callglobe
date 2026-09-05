import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { del, put } from '../../shared/object-store.js';
import { readStoredObject } from '../../shared/stored-object-read.js';
import { requiredEnv } from '../../shared/http.js';

export type ConferenceCall = {
  room: string;
  hostCallControlId: string;
  conferenceId: string;
  guestCallControlIds: string[];
  ended?: boolean;
  updatedAt: string;
};

function key() { return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:conference-calls`).digest(); }
function id(value: string) { return createHash('sha256').update(value).digest('hex'); }
function pathname(room: string) { return `vocivo/conference-calls/${id(room)}.bin`; }
function endedPathname(room: string) { return `vocivo/conference-calls/${id(room)}.ended.bin`; }
function encrypt(value: ConferenceCall) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
function decrypt(value: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as ConferenceCall;
}

export async function markConferenceEnded(room: string) {
  await put(endedPathname(room), Buffer.from('ended'), { access: 'private', contentType: 'application/octet-stream', allowOverwrite: true });
}

export async function isConferenceEnded(room: string) {
  try {
    return Boolean(await readStoredObject(endedPathname(room)));
  } catch {
    return false;
  }
}

export async function saveConferenceCall(value: ConferenceCall) {
  await put(pathname(value.room), encrypt(value), { access: 'private', contentType: 'application/octet-stream', allowOverwrite: true });
}

export async function readConferenceCall(room: string) {
  try {
    const value = await readStoredObject(pathname(room));
    return value ? decrypt(value) : null;
  } catch { return null; }
}

export async function clearConferenceCall(room: string) {
  await del(pathname(room));
}

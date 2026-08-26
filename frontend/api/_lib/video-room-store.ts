import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { list, put, readObject } from './object-store.js';
import { requiredEnv } from './http.js';

export type VideoRoom = {
  roomId: string;
  organizationId: string;
  createdBy: string;
  createdAt: string;
};

function key() { return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:video-rooms`).digest(); }
function path(roomId: string) { return `vocivo/video-rooms/${roomId}.bin`; }
function encrypt(value: VideoRoom) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
function decrypt(value: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as VideoRoom;
}

export async function saveVideoRoom(room: VideoRoom) {
  await put(path(room.roomId), encrypt(room), { access: 'public', contentType: 'application/octet-stream', allowOverwrite: false });
  return room;
}

export async function readVideoRoom(roomId: string) {
  try {
    const result = await list({ prefix: path(roomId), limit: 1 });
    const blob = result.blobs[0];
    if (!blob) return null;
    const value = await readObject(blob.pathname);
    return value ? decrypt(value) : null;
  } catch {
    return null;
  }
}

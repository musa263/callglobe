import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { del, put } from './object-store.js';
import { readStoredObject } from './stored-object-read.js';
import { requiredEnv } from './http.js';

export type QueueCall = {
  queueName: string;
  parentCallControlId: string;
  organizationId: string;
  handlingId: string;
  kind: 'ring_group' | 'queue';
  status: 'waiting' | 'dialing' | 'connecting' | 'connected';
  agentCallControlIds: string[];
  updatedAt: string;
};

function key() { return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:queue-calls`).digest(); }
function id(value: string) { return createHash('sha256').update(value).digest('hex'); }
function pathname(queueName: string) { return `vocivo/queue-calls/${id(queueName)}.bin`; }
function encrypt(value: QueueCall) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
function decrypt(value: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as QueueCall;
}

export async function saveQueueCall(value: QueueCall) {
  await put(pathname(value.queueName), encrypt(value), { access: 'private', contentType: 'application/octet-stream', allowOverwrite: true });
}

export async function readQueueCall(queueName: string) {
  try {
    const value = await readStoredObject(pathname(queueName));
    return value ? decrypt(value) : null;
  } catch { return null; }
}

export async function clearQueueCall(queueName: string) {
  await del(pathname(queueName));
}

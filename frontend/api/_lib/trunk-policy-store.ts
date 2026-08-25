import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { put } from '@vercel/blob';
import { readFreshPublicBlob } from './blob-read.js';
import { requiredEnv } from './http.js';

export type TrunkPolicy = {
  id: string;
  organizationId: string;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  inboundDids: string[];
  defaultDestination: string;
  outboundPrefix: string;
  priority: number;
  failoverTrunkId: string;
  channelLimit: number;
  codecs: string[];
  mediaEncryption: boolean;
  notes: string;
  updatedAt: string;
};

const pathname = 'vocivo/pbx/trunk-policies.bin';

function encryptionKey() { return createHash('sha256').update(requiredEnv('AUTH_SECRET')).digest(); }

function encrypt(value: Record<string, TrunkPolicy>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function decrypt(value: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as Record<string, TrunkPolicy>;
}

export function normalizeTrunkPolicy(id: string, input: Partial<TrunkPolicy>, current?: TrunkPolicy): TrunkPolicy {
  const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const editableText = (value: unknown, previous: string | undefined, max: number) => value === undefined ? previous || '' : text(value, max);
  const dids = Array.isArray(input.inboundDids) ? input.inboundDids : current?.inboundDids ?? [];
  const codecs = Array.isArray(input.codecs) ? input.codecs : current?.codecs ?? ['PCMU', 'PCMA'];
  return {
    id,
    organizationId: text(input.organizationId, 50) || current?.organizationId || 'primary',
    inboundEnabled: input.inboundEnabled ?? current?.inboundEnabled ?? true,
    outboundEnabled: input.outboundEnabled ?? current?.outboundEnabled ?? true,
    inboundDids: dids.map((item) => text(item, 24)).filter(Boolean).slice(0, 100),
    defaultDestination: editableText(input.defaultDestination, current?.defaultDestination, 200),
    outboundPrefix: editableText(input.outboundPrefix, current?.outboundPrefix, 20),
    priority: Math.max(1, Math.min(100, Number(input.priority ?? current?.priority ?? 1) || 1)),
    failoverTrunkId: editableText(input.failoverTrunkId, current?.failoverTrunkId, 80),
    channelLimit: Math.max(1, Math.min(10000, Number(input.channelLimit ?? current?.channelLimit ?? 10) || 10)),
    codecs: codecs.filter((item) => ['PCMU', 'PCMA', 'G722', 'OPUS'].includes(item)).slice(0, 4),
    mediaEncryption: input.mediaEncryption ?? current?.mediaEncryption ?? true,
    notes: editableText(input.notes, current?.notes, 500),
    updatedAt: new Date().toISOString(),
  };
}

export async function readTrunkPolicies() {
  try {
    const value = await readFreshPublicBlob(pathname);
    return value ? decrypt(value) : {};
  } catch {
    return {};
  }
}

async function writeTrunkPolicies(value: Record<string, TrunkPolicy>) {
  await put(pathname, encrypt(value), { access: 'public', contentType: 'application/octet-stream', allowOverwrite: true });
}

export async function saveTrunkPolicy(id: string, input: Partial<TrunkPolicy>) {
  const policies = await readTrunkPolicies();
  const policy = normalizeTrunkPolicy(id, input, policies[id]);
  await writeTrunkPolicies({ ...policies, [id]: policy });
  return policy;
}

export async function deleteTrunkPolicy(id: string) {
  const policies = await readTrunkPolicies();
  if (!(id in policies)) return;
  delete policies[id];
  await writeTrunkPolicies(policies);
}

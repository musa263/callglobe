import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { list, put } from '@vercel/blob';
import { requiredEnv } from './http.js';

export type PbxConfig = {
  version: number;
  company: { name: string; timezone: string; defaultCallerId: string; emergencyAddress: string };
  userProfiles: Record<string, {
    outboundCallerId: string; did: string; twoFactorEnabled: boolean; noAnswerSeconds: number;
    forwardBusy: string; forwardNoAnswer: string; forwardUnavailable: string; simultaneousRing: string;
    voicemailEnabled: boolean; voicemailEmail: boolean; voicemailTranscription: boolean;
    schedule: string; permissions: { international: boolean; transfer: boolean; video: boolean; recording: boolean; reports: boolean };
  }>;
  departments: Array<{ id: string; name: string; managerExtension: string }>;
  outboundRules: Array<{ id: string; name: string; prefix: string; extensionRange: string; numberLength: string; department: string; routes: string[]; enabled: boolean }>;
  officeHours: { timezone: string; weekdays: Record<string, { enabled: boolean; start: string; end: string }>; holidays: Array<{ id: string; name: string; date: string; destination: string }> };
  callHandling: {
    ringGroups: Array<{ id: string; name: string; extension: string; strategy: string; members: string[]; timeout: number; fallback: string }>;
    queues: Array<{ id: string; name: string; extension: string; strategy: string; members: string[]; maxWait: number; fallback: string }>;
    ivrs: Array<{ id: string; name: string; extension: string; greeting: string; options: Record<string, string> }>;
  };
  ai: {
    enabled: boolean; assistantId: string; name: string; greeting: string; instructions: string; knowledge: string;
    voice: string; language: string; fallbackExtension: string; transferEnabled: boolean; summariesEnabled: boolean;
  };
  system: { recordingEnabled: boolean; retentionDays: number; emergencyCallingEnabled: boolean };
  updatedAt: string;
};

const pathname = 'vocivo/pbx/config.bin';

const weekdays = Object.fromEntries(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => [day, { enabled: !['Saturday', 'Sunday'].includes(day), start: '09:00', end: '17:00' }]));

export function defaultPbxConfig(): PbxConfig {
  return {
    version: 1,
    company: { name: 'Global Heritage', timezone: 'Asia/Riyadh', defaultCallerId: '', emergencyAddress: '' },
    userProfiles: {},
    departments: [{ id: 'general', name: 'General', managerExtension: '' }, { id: 'sales', name: 'Sales', managerExtension: '' }, { id: 'operations', name: 'Operations', managerExtension: '' }],
    outboundRules: [{ id: 'international', name: 'International calling', prefix: '+', extensionRange: '', numberLength: '', department: 'All', routes: ['Vocivo Telnyx'], enabled: true }],
    officeHours: { timezone: 'Asia/Riyadh', weekdays, holidays: [] },
    callHandling: { ringGroups: [], queues: [], ivrs: [] },
    ai: { enabled: false, assistantId: '', name: 'Global Heritage Receptionist', greeting: 'Welcome to Global Heritage. How may I help you today?', instructions: 'You are a professional company receptionist. Answer questions using only the approved company information. Ask concise clarifying questions. If you cannot answer, offer to connect the caller to a colleague.', knowledge: '', voice: 'Telnyx.Bayan.Amanda', language: 'en', fallbackExtension: '102', transferEnabled: true, summariesEnabled: true },
    system: { recordingEnabled: false, retentionDays: 30, emergencyCallingEnabled: false },
    updatedAt: new Date().toISOString(),
  };
}

function key() { return createHash('sha256').update(requiredEnv('AUTH_SECRET')).digest(); }
function encrypt(value: PbxConfig) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}
function decrypt(value: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as PbxConfig;
}

function mergeConfig(stored?: Partial<PbxConfig>): PbxConfig {
  const base = defaultPbxConfig();
  if (!stored) return base;
  return {
    ...base, ...stored,
    company: { ...base.company, ...(stored.company || {}) },
    officeHours: { ...base.officeHours, ...(stored.officeHours || {}), weekdays: { ...base.officeHours.weekdays, ...(stored.officeHours?.weekdays || {}) } },
    callHandling: { ...base.callHandling, ...(stored.callHandling || {}) },
    ai: { ...base.ai, ...(stored.ai || {}) }, system: { ...base.system, ...(stored.system || {}) },
    userProfiles: stored.userProfiles || {}, updatedAt: stored.updatedAt || base.updatedAt,
  };
}

export async function readPbxConfig() {
  const result = await list({ prefix: pathname, limit: 1 });
  if (!result.blobs[0]) return defaultPbxConfig();
  try {
    const response = await fetch(result.blobs[0].url);
    return response.ok ? mergeConfig(decrypt(Buffer.from(await response.arrayBuffer()))) : defaultPbxConfig();
  } catch { return defaultPbxConfig(); }
}

export async function savePbxConfig(input: Partial<PbxConfig>) {
  const current = await readPbxConfig();
  const next = mergeConfig({ ...current, ...input, updatedAt: new Date().toISOString() });
  await put(pathname, encrypt(next), { access: 'public', contentType: 'application/octet-stream', allowOverwrite: true });
  return next;
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { list, put } from '@vercel/blob';
import { requiredEnv } from './http.js';

export type PbxConfig = {
  version: number;
  company: { name: string; timezone: string; defaultCallerId: string; emergencyAddress: string };
  activeOrganizationId: string;
  organizations: Array<{
    id: string; name: string; slug: string; extensionStart: number; extensionEnd: number;
    internalCallingEnabled: boolean; status: 'active' | 'suspended';
  }>;
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
  platform: {
    controlPlane: 'vocivo'; mediaPlane: 'telnyx' | 'vocivo'; pstnProvider: 'telnyx';
    sipDomain: string; ttsProvider: 'vocivo' | 'telnyx'; carrierFallbackEnabled: boolean;
  };
  updatedAt: string;
};

const pathname = 'vocivo/pbx/config.bin';

const weekdays = Object.fromEntries(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => [day, { enabled: !['Saturday', 'Sunday'].includes(day), start: '09:00', end: '17:00' }]));

export function defaultPbxConfig(): PbxConfig {
  return {
    version: 2,
    company: { name: 'Global Heritage', timezone: 'Asia/Riyadh', defaultCallerId: '', emergencyAddress: '' },
    activeOrganizationId: 'primary',
    organizations: [{ id: 'primary', name: 'Global Heritage', slug: 'global-heritage', extensionStart: 2000, extensionEnd: 2019, internalCallingEnabled: true, status: 'active' }],
    userProfiles: {},
    departments: [{ id: 'general', name: 'General', managerExtension: '' }, { id: 'sales', name: 'Sales', managerExtension: '' }, { id: 'operations', name: 'Operations', managerExtension: '' }],
    outboundRules: [{ id: 'international', name: 'International calling', prefix: '+', extensionRange: '', numberLength: '', department: 'All', routes: ['Vocivo Telnyx'], enabled: true }],
    officeHours: { timezone: 'Asia/Riyadh', weekdays, holidays: [] },
    callHandling: { ringGroups: [], queues: [], ivrs: [] },
    ai: { enabled: false, assistantId: '', name: 'Global Heritage Receptionist', greeting: 'Welcome to Global Heritage. How may I help you today?', instructions: 'You are a professional company receptionist. Answer questions using only the approved company information. Ask concise clarifying questions. If you cannot answer, offer to connect the caller to a colleague.', knowledge: '', voice: 'Telnyx.Bayan.Amanda', language: 'en', fallbackExtension: '102', transferEnabled: true, summariesEnabled: true },
    system: { recordingEnabled: false, retentionDays: 30, emergencyCallingEnabled: false },
    platform: { controlPlane: 'vocivo', mediaPlane: 'telnyx', pstnProvider: 'telnyx', sipDomain: 'sip.telnyx.com', ttsProvider: 'vocivo', carrierFallbackEnabled: true },
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
    platform: { ...base.platform, ...(stored.platform || {}) },
    organizations: stored.organizations?.length ? stored.organizations : base.organizations,
    activeOrganizationId: stored.activeOrganizationId || base.activeOrganizationId,
    userProfiles: stored.userProfiles || {}, updatedAt: stored.updatedAt || base.updatedAt,
  };
}

function validateOrganizations(config: PbxConfig) {
  if (!config.organizations.length) throw new Error('At least one organization is required.');
  const ids = new Set<string>();
  for (const organization of config.organizations) {
    if (!organization.id || ids.has(organization.id)) throw new Error('Each organization must have a unique ID.');
    ids.add(organization.id);
    if (!organization.name.trim()) throw new Error('Organization name is required.');
    if (!Number.isInteger(organization.extensionStart) || !Number.isInteger(organization.extensionEnd) || organization.extensionStart < 10 || organization.extensionEnd > 99999 || organization.extensionEnd < organization.extensionStart) throw new Error('Extension ranges must contain 2 to 5 digit numbers in ascending order.');
    if (organization.extensionEnd - organization.extensionStart + 1 > 10000) throw new Error('An organization extension range cannot exceed 10,000 slots.');
  }
  if (!ids.has(config.activeOrganizationId)) throw new Error('The active organization is invalid.');
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
  validateOrganizations(next);
  await put(pathname, encrypt(next), { access: 'public', contentType: 'application/octet-stream', allowOverwrite: true });
  return next;
}

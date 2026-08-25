import bcrypt from 'bcryptjs';
import { requiredEnv } from './http.js';
import { telnyx } from './telnyx.js';

export type BusinessVoiceConfig = {
  enabled: boolean;
  voicemailEnabled: boolean;
  voicemailDelaySeconds: number;
  voicemailGreeting: string;
  companyName: string;
  greeting: string;
  waitingMessage: string;
  departments: string[];
  voice: string;
  backgroundImageUrl: string;
};

const configPrefix = 'vocfg_';
const passwordPrefix = 'vopwd_';
const legacyConfigPrefix = ['cg', 'cfg_'].join('');
const legacyPasswordPrefix = ['cg', 'pwd_'].join('');
const defaults: BusinessVoiceConfig = {
  enabled: false,
  voicemailEnabled: false,
  voicemailDelaySeconds: 25,
  voicemailGreeting: 'We are unable to answer your call. Please leave a message after the tone.',
  companyName: 'Global Heritage',
  greeting: 'Welcome to Global Heritage.',
  waitingMessage: 'Thank you for waiting. A member of our team will be with you shortly.',
  departments: ['Sales', 'Operations'],
  voice: 'AWS.Polly.Joanna-Neural',
  backgroundImageUrl: '',
};

type NumberResource = { tags?: string[] };

async function readTags() {
  const response = await telnyx(`/phone_numbers/${requiredEnv('TELNYX_PHONE_NUMBER_ID')}`);
  const payload = await response.json() as { data?: NumberResource };
  return payload.data?.tags ?? [];
}

async function writeTags(tags: string[]) {
  await telnyx(`/phone_numbers/${requiredEnv('TELNYX_PHONE_NUMBER_ID')}`, {
    method: 'PATCH',
    body: JSON.stringify({ tags }),
  });
}

async function writeNumber(body: Record<string, unknown>) {
  await telnyx(`/phone_numbers/${requiredEnv('TELNYX_PHONE_NUMBER_ID')}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

function bounded(value: unknown, fallback: string, max: number) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
}

function voicemailDelay(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(60, Math.max(15, Math.round(parsed))) : defaults.voicemailDelaySeconds;
}

function departments(value: unknown, legacyOne?: unknown, legacyTwo?: unknown) {
  const source = Array.isArray(value) ? value : [legacyOne, legacyTwo];
  const normalized = source.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim().slice(0, 40)).slice(0, 5);
  return normalized.length >= 2 ? normalized : defaults.departments;
}

export async function readBusinessVoiceConfig(): Promise<BusinessVoiceConfig> {
  const tags = await readTags();
  const current = tags.filter((tag) => tag.startsWith(configPrefix));
  const sourcePrefix = current.length ? configPrefix : legacyConfigPrefix;
  const chunks = tags.map((tag) => tag.startsWith(sourcePrefix) ? tag.slice(sourcePrefix.length).match(/^(\d+)_(.+)$/) : null).filter((match): match is RegExpMatchArray => Boolean(match)).sort((a, b) => Number(a[1]) - Number(b[1])).map((match) => match[2]);
  if (!chunks.length) return defaults;
  try {
    const stored = JSON.parse(Buffer.from(chunks.join(''), 'base64url').toString('utf8')) as Partial<BusinessVoiceConfig>;
    return {
      enabled: Boolean(stored.enabled),
      voicemailEnabled: Boolean(stored.voicemailEnabled),
      voicemailDelaySeconds: voicemailDelay(stored.voicemailDelaySeconds),
      voicemailGreeting: bounded(stored.voicemailGreeting, defaults.voicemailGreeting, 500),
      companyName: bounded(stored.companyName, defaults.companyName, 80),
      greeting: bounded(stored.greeting, defaults.greeting, 500),
      waitingMessage: bounded(stored.waitingMessage, defaults.waitingMessage, 500),
      departments: departments(stored.departments, (stored as Partial<BusinessVoiceConfig> & { departmentOne?: string }).departmentOne, (stored as Partial<BusinessVoiceConfig> & { departmentTwo?: string }).departmentTwo),
      voice: bounded(stored.voice, defaults.voice, 100),
      backgroundImageUrl: typeof stored.backgroundImageUrl === 'string' && /^https:\/\//.test(stored.backgroundImageUrl) ? stored.backgroundImageUrl.slice(0, 500) : '',
    };
  } catch {
    return defaults;
  }
}

export async function saveBusinessVoiceConfig(input: Partial<BusinessVoiceConfig>) {
  const config: BusinessVoiceConfig = {
    enabled: Boolean(input.enabled),
    voicemailEnabled: Boolean(input.voicemailEnabled),
    voicemailDelaySeconds: voicemailDelay(input.voicemailDelaySeconds),
    voicemailGreeting: bounded(input.voicemailGreeting, defaults.voicemailGreeting, 500),
    companyName: bounded(input.companyName, defaults.companyName, 80),
    greeting: bounded(input.greeting, defaults.greeting, 500),
    waitingMessage: bounded(input.waitingMessage, defaults.waitingMessage, 500),
    departments: departments(input.departments),
    voice: bounded(input.voice, defaults.voice, 100),
    backgroundImageUrl: typeof input.backgroundImageUrl === 'string' && /^https:\/\//.test(input.backgroundImageUrl) ? input.backgroundImageUrl.slice(0, 500) : '',
  };
  const tags = await readTags();
  const encoded = Buffer.from(JSON.stringify(config)).toString('base64url');
  const chunks = encoded.match(/.{1,70}/g) ?? [];
  const managed = chunks.map((chunk, index) => `${configPrefix}${index}_${chunk}`);
  const nextTags = [...tags.filter((tag) => !tag.startsWith(configPrefix) && !tag.startsWith(legacyConfigPrefix)), ...managed];
  await writeNumber({
    tags: nextTags,
    connection_id: (config.enabled || config.voicemailEnabled) ? requiredEnv('TELNYX_CALL_CONTROL_APP_ID') : requiredEnv('TELNYX_CONNECTION_ID'),
  });
  return config;
}

export async function readPasswordHash() {
  const tags = await readTags();
  const current = tags.find((tag) => tag.startsWith(passwordPrefix));
  const legacy = tags.find((tag) => tag.startsWith(legacyPasswordPrefix));
  const encoded = current?.slice(passwordPrefix.length) || legacy?.slice(legacyPasswordPrefix.length);
  return encoded ? Buffer.from(encoded, 'base64url').toString('utf8') : requiredEnv('APP_PASSWORD_HASH');
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const currentHash = await readPasswordHash();
  if (!await bcrypt.compare(currentPassword, currentHash)) return false;
  const tags = await readTags();
  const nextHash = await bcrypt.hash(newPassword, 12);
  await writeTags([...tags.filter((tag) => !tag.startsWith(passwordPrefix) && !tag.startsWith(legacyPasswordPrefix)), `${passwordPrefix}${Buffer.from(nextHash).toString('base64url')}`]);
  return true;
}

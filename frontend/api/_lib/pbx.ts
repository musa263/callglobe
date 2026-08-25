import { requiredEnv } from './http.js';
import { telnyx } from './telnyx.js';

const extensionTag = 'vocivo_extension';
const legacyExtensionTag = ['call', 'globe_extension'].join('');
const credentialPrefix = 'VOCEXT';
const legacyCredentialPrefix = ['CG', 'EXT'].join('');
const connectionResource = () => `connection:${requiredEnv('TELNYX_CONNECTION_ID')}`;

export type ExtensionUser = {
  id: string;
  extension: string;
  name: string;
  email: string;
  mobile: string;
  department: string;
  role: 'admin' | 'manager' | 'user';
  sipUsername: string;
  status: 'active' | 'expired';
  createdAt?: string;
};

type CredentialResource = {
  id: string;
  name?: string;
  tag?: string | null;
  expired?: boolean;
  resource_id?: string;
  sip_username?: string;
  sip_password?: string;
  created_at?: string;
};

function clean(value: unknown, max: number) {
  return typeof value === 'string' ? value.replace(/[|\r\n]/g, ' ').trim().slice(0, max) : '';
}

function normalizeRole(value: unknown): ExtensionUser['role'] {
  return value === 'admin' || value === 'manager' ? value : 'user';
}

function encodeName(input: Partial<ExtensionUser>) {
  return [credentialPrefix, clean(input.extension, 5), clean(input.name, 50), clean(input.department, 30), normalizeRole(input.role), clean(input.email, 70), clean(input.mobile, 24)].join('|');
}

function parseCredential(item: CredentialResource): ExtensionUser | null {
  if (![extensionTag, legacyExtensionTag].includes(item.tag || '') || item.resource_id !== connectionResource()) return null;
  const [prefix, extension, name, department, role, email, mobile] = (item.name || '').split('|');
  if (![credentialPrefix, legacyCredentialPrefix].includes(prefix || '') || !/^\d{2,5}$/.test(extension || '')) return null;
  return {
    id: item.id,
    extension,
    name: name || `Extension ${extension}`,
    department: department || 'General',
    role: normalizeRole(role),
    email: email || '',
    mobile: mobile || '',
    sipUsername: item.sip_username || '',
    status: item.expired ? 'expired' : 'active',
    createdAt: item.created_at,
  };
}

export async function listExtensions(): Promise<ExtensionUser[]> {
  const query = new URLSearchParams({ 'page[size]': '250', 'filter[resource_id]': connectionResource() });
  const response = await telnyx(`/telephony_credentials?${query}`);
  const payload = await response.json() as { data?: CredentialResource[] };
  return (payload.data ?? []).map(parseCredential).filter((item): item is ExtensionUser => Boolean(item)).sort((a, b) => Number(a.extension) - Number(b.extension));
}

function validateExtensionInput(input: Partial<ExtensionUser>) {
  const extension = clean(input.extension, 5);
  const name = clean(input.name, 50);
  if (!/^\d{2,5}$/.test(extension)) throw new Error('Extension must contain 2 to 5 digits.');
  if (!name) throw new Error('User name is required.');
  return { ...input, extension, name, department: clean(input.department, 30) || 'General', email: clean(input.email, 70), mobile: clean(input.mobile, 24), role: normalizeRole(input.role) };
}

export async function createExtension(input: Partial<ExtensionUser>) {
  const value = validateExtensionInput(input);
  if ((await listExtensions()).some((item) => item.extension === value.extension)) throw new Error(`Extension ${value.extension} already exists.`);
  const response = await telnyx('/telephony_credentials', {
    method: 'POST',
    body: JSON.stringify({ connection_id: requiredEnv('TELNYX_CONNECTION_ID'), name: encodeName(value), tag: extensionTag }),
  });
  const payload = await response.json() as { data?: CredentialResource };
  const data = payload.data;
  if (!data) throw new Error('Telnyx did not create the extension.');
  return {
    extension: parseCredential(data),
    oneTimeCredentials: { sipUsername: data.sip_username || '', sipPassword: data.sip_password || '', server: 'sip.telnyx.com', transport: 'TLS or UDP' },
  };
}

async function requireManagedCredential(id: string) {
  const response = await telnyx(`/telephony_credentials/${encodeURIComponent(id)}`);
  const payload = await response.json() as { data?: CredentialResource };
  const parsed = payload.data ? parseCredential(payload.data) : null;
  if (!parsed) throw new Error('Extension not found.');
  return parsed;
}

export async function getExtension(id: string) {
  return requireManagedCredential(id);
}

export async function getExtensionCredentials(id: string) {
  const extension = await requireManagedCredential(id);
  const response = await telnyx(`/telephony_credentials/${encodeURIComponent(id)}`);
  const payload = await response.json() as { data?: CredentialResource };
  const data = payload.data;
  if (!data?.sip_username || !data.sip_password) throw new Error('Telnyx did not return extension credentials.');
  return { extension, sipUsername: data.sip_username, sipPassword: data.sip_password };
}

export async function updateExtension(id: string, input: Partial<ExtensionUser>) {
  const existing = await requireManagedCredential(id);
  const value = validateExtensionInput({ ...existing, ...input });
  const duplicate = (await listExtensions()).find((item) => item.extension === value.extension && item.id !== id);
  if (duplicate) throw new Error(`Extension ${value.extension} already exists.`);
  const response = await telnyx(`/telephony_credentials/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name: encodeName(value), tag: extensionTag }) });
  const payload = await response.json() as { data?: CredentialResource };
  return payload.data ? parseCredential(payload.data) : null;
}

export async function deleteExtension(id: string) {
  await requireManagedCredential(id);
  await telnyx(`/telephony_credentials/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function findExtension(number: string) {
  return (await listExtensions()).find((item) => item.extension === number && item.status === 'active') ?? null;
}

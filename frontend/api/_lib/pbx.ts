import { requiredEnv } from './http.js';
import { telnyx } from './telnyx.js';
import { readPbxConfig } from './pbx-config-store.js';
import { revokeExtensionSessions } from './extension-session-store.js';

const extensionTag = 'vocivo_extension';
const credentialPrefix = 'VOCEXT';
const connectionResource = () => `connection:${requiredEnv('TELNYX_CONNECTION_ID')}`;

export type ExtensionUser = {
  id: string;
  extension: string;
  name: string;
  email: string;
  mobile: string;
  organizationId: string;
  department: string;
  role: 'company_owner' | 'company_admin' | 'manager' | 'user' | 'individual';
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
  if (value === 'owner' || value === 'company_owner') return 'company_owner';
  if (value === 'admin' || value === 'company_admin') return 'company_admin';
  if (value === 'manager' || value === 'individual') return value;
  return 'user';
}

function encodeName(input: Partial<ExtensionUser>) {
  return [credentialPrefix, clean(input.extension, 5), clean(input.name, 50), clean(input.department, 30), normalizeRole(input.role), clean(input.email, 70), clean(input.mobile, 24), clean(input.organizationId, 50) || 'primary'].join('|');
}

function parseCredential(item: CredentialResource): ExtensionUser | null {
  if (item.tag !== extensionTag || item.resource_id !== connectionResource()) return null;
  const [prefix, extension, name, department, role, email, mobile, organizationId] = (item.name || '').split('|');
  if (prefix !== credentialPrefix || !/^\d{2,5}$/.test(extension || '')) return null;
  return {
    id: item.id,
    extension,
    name: name || `Extension ${extension}`,
    department: department || 'General',
    role: normalizeRole(role),
    email: email || '',
    mobile: mobile || '',
    organizationId: organizationId || 'primary',
    sipUsername: item.sip_username || '',
    status: item.expired ? 'expired' : 'active',
    createdAt: item.created_at,
  };
}

export async function listExtensions(organizationId?: string): Promise<ExtensionUser[]> {
  const query = new URLSearchParams({ 'page[size]': '250', 'filter[resource_id]': connectionResource() });
  const response = await telnyx(`/telephony_credentials?${query}`);
  const payload = await response.json() as { data?: CredentialResource[] };
  return (payload.data ?? []).map(parseCredential).filter((item): item is ExtensionUser => Boolean(item) && (!organizationId || item?.organizationId === organizationId)).sort((a, b) => Number(a.extension) - Number(b.extension));
}

function validateExtensionInput(input: Partial<ExtensionUser>, extension: string) {
  const name = clean(input.name, 50);
  if (!/^\d{2,5}$/.test(extension)) throw new Error('Extension must contain 2 to 5 digits.');
  if (!name) throw new Error('User name is required.');
  return { ...input, extension, name, organizationId: clean(input.organizationId, 50) || 'primary', department: clean(input.department, 30) || 'General', email: clean(input.email, 70), mobile: clean(input.mobile, 24), role: normalizeRole(input.role) };
}

async function extensionForCreate(input: Partial<ExtensionUser>) {
  const config = await readPbxConfig();
  const organizationId = clean(input.organizationId, 50) || config.activeOrganizationId;
  const organization = config.organizations.find((item) => item.id === organizationId && item.status === 'active');
  if (!organization) throw new Error('Organization is not active.');
  if (organization.extensionEnd < organization.extensionStart || organization.extensionEnd - organization.extensionStart > 9999) throw new Error('Organization extension range is invalid.');
  const existing = await listExtensions(organizationId);
  const requested = clean(input.extension, 5);
  const extension = requested || Array.from({ length: organization.extensionEnd - organization.extensionStart + 1 }, (_, index) => String(organization.extensionStart + index)).find((candidate) => !existing.some((item) => item.extension === candidate)) || '';
  if (!extension) throw new Error('This organization has no available extension slots.');
  const numeric = Number(extension);
  if (!Number.isInteger(numeric) || numeric < organization.extensionStart || numeric > organization.extensionEnd) throw new Error(`Extension must be between ${organization.extensionStart} and ${organization.extensionEnd}.`);
  return { extension, organizationId, existing, accountType: organization.accountType };
}

export async function createExtension(input: Partial<ExtensionUser>) {
  const allocated = await extensionForCreate(input);
  const value = validateExtensionInput({ ...input, organizationId: allocated.organizationId, role: allocated.accountType === 'individual' ? 'individual' : input.role }, allocated.extension);
  if (allocated.existing.some((item) => item.extension === value.extension)) throw new Error(`Extension ${value.extension} already exists.`);
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
  const value = validateExtensionInput({ ...existing, ...input }, clean(input.extension, 5) || existing.extension);
  const config = await readPbxConfig();
  const organization = config.organizations.find((item) => item.id === value.organizationId && item.status === 'active');
  if (!organization) throw new Error('Organization is not active.');
  const numeric = Number(value.extension);
  const extensionChanged = value.extension !== existing.extension || value.organizationId !== existing.organizationId;
  if (extensionChanged && (numeric < organization.extensionStart || numeric > organization.extensionEnd)) throw new Error(`Extension must be between ${organization.extensionStart} and ${organization.extensionEnd}.`);
  const duplicate = (await listExtensions(value.organizationId)).find((item) => item.extension === value.extension && item.id !== id);
  if (duplicate) throw new Error(`Extension ${value.extension} already exists.`);
  const response = await telnyx(`/telephony_credentials/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name: encodeName(value), tag: extensionTag }) });
  const payload = await response.json() as { data?: CredentialResource };
  await revokeExtensionSessions(id);
  return payload.data ? parseCredential(payload.data) : null;
}

export async function deleteExtension(id: string) {
  await requireManagedCredential(id);
  await revokeExtensionSessions(id);
  await telnyx(`/telephony_credentials/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function findExtension(number: string, organizationId?: string) {
  return (await listExtensions(organizationId)).find((item) => item.extension === number && item.status === 'active') ?? null;
}

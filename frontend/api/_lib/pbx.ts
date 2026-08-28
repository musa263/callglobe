import { randomBytes, randomUUID } from 'node:crypto';
import { requiredEnv } from './http.js';
import { telnyx } from './telnyx.js';
import { readPbxConfig } from './pbx-config-store.js';
import { revokeExtensionSessions } from './extension-session-store.js';
import {
  deleteExtensionCredential,
  readExtensionCredential,
  readExtensionDirectory,
  saveExtensionCredential,
  saveExtensionDirectory,
} from './extension-store.js';
import { organizationSipDomain, voiceProvider } from './voice-provider.js';

const extensionTag = 'vocivo_extension';
const credentialPrefix = 'VOCEXT';
const connectionResource = () => `connection:${requiredEnv('TELNYX_CONNECTION_ID')}`;
const extensionCacheTtlMs = 15_000;
let extensionCache: { expiresAt: number; value: ExtensionUser[] } | null = null;
let extensionRequest: Promise<ExtensionUser[]> | null = null;
const credentialCache = new Map<string, { expiresAt: number; parsed: ExtensionUser; data: CredentialResource }>();

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
  sipProvider?: 'telnyx' | 'freeswitch';
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
  const organizationId = clean(input.organizationId, 50);
  if (!organizationId) throw new Error('A tenant organization is required for every extension.');
  return [credentialPrefix, clean(input.extension, 5), clean(input.name, 50), clean(input.department, 30), normalizeRole(input.role), clean(input.email, 70), clean(input.mobile, 24), organizationId].join('|');
}

function parseCredential(item: CredentialResource): ExtensionUser | null {
  if (item.tag !== extensionTag || item.resource_id !== connectionResource()) return null;
  const [prefix, extension, name, department, role, email, mobile, organizationId] = (item.name || '').split('|');
  if (prefix !== credentialPrefix || !/^\d{2,5}$/.test(extension || '') || !organizationId) return null;
  return {
    id: item.id,
    extension,
    name: name || `Extension ${extension}`,
    department: department || 'General',
    role: normalizeRole(role),
    email: email || '',
    mobile: mobile || '',
    organizationId,
    sipUsername: item.sip_username || '',
    status: item.expired ? 'expired' : 'active',
    createdAt: item.created_at,
  };
}

export async function listExtensions(organizationId?: string): Promise<ExtensionUser[]> {
  if (!extensionCache || extensionCache.expiresAt <= Date.now()) {
    extensionRequest ||= (async () => {
      const stored = await readExtensionDirectory();
      if (stored) {
        extensionCache = { expiresAt: Date.now() + extensionCacheTtlMs, value: stored };
        return stored;
      }
      const query = new URLSearchParams({ 'page[size]': '250', 'filter[resource_id]': connectionResource() });
      const response = await telnyx(`/telephony_credentials?${query}`);
      const payload = await response.json() as { data?: CredentialResource[] };
      const value = (payload.data ?? []).map(parseCredential).filter((item): item is ExtensionUser => Boolean(item)).sort((a, b) => Number(a.extension) - Number(b.extension));
      await saveExtensionDirectory(value);
      extensionCache = { expiresAt: Date.now() + extensionCacheTtlMs, value };
      return value;
    })().finally(() => { extensionRequest = null; });
    await extensionRequest;
  }
  return (extensionCache?.value || []).filter((item) => !organizationId || item.organizationId === organizationId);
}

function invalidateExtensionCache() { extensionCache = null; }

async function replaceStoredExtension(extension: ExtensionUser | null, removedId?: string) {
  const current = await listExtensions();
  const next = current
    .filter((item) => item.id !== (removedId || extension?.id))
    .concat(extension ? [extension] : [])
    .sort((a, b) => Number(a.extension) - Number(b.extension));
  await saveExtensionDirectory(next);
  extensionCache = { expiresAt: Date.now() + extensionCacheTtlMs, value: next };
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
  const config = await readPbxConfig();
  if (voiceProvider(config) === 'freeswitch') {
    const sipDomain = organizationSipDomain(config, value.organizationId);
    const extension: ExtensionUser = {
      ...value,
      id: `vocivo_${randomUUID()}`,
      sipUsername: value.extension,
      sipProvider: 'freeswitch',
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    const sipPassword = randomBytes(32).toString('base64url');
    await Promise.all([
      replaceStoredExtension(extension),
      saveExtensionCredential({ extension, sipUsername: extension.sipUsername, sipPassword, provider: 'freeswitch', sipDomain }),
    ]);
    return {
      extension,
      oneTimeCredentials: { sipUsername: extension.sipUsername, sipPassword, server: sipDomain, transport: 'WSS or TLS' },
    };
  }
  const response = await telnyx('/telephony_credentials', {
    method: 'POST',
    body: JSON.stringify({ connection_id: requiredEnv('TELNYX_CONNECTION_ID'), name: encodeName(value), tag: extensionTag }),
  });
  const payload = await response.json() as { data?: CredentialResource };
  const data = payload.data ? { ...payload.data, tag: extensionTag, resource_id: connectionResource() } : undefined;
  if (!data) throw new Error('Telnyx did not create the extension.');
  const extension = parseCredential(data);
  if (!extension) throw new Error('Telnyx returned invalid extension data.');
  extension.sipProvider = 'telnyx';
  await Promise.all([
    replaceStoredExtension(extension),
    saveExtensionCredential({ extension, sipUsername: data.sip_username || '', sipPassword: data.sip_password || '', provider: 'telnyx', sipDomain: 'sip.telnyx.com' }),
  ]);
  return {
    extension,
    oneTimeCredentials: { sipUsername: data.sip_username || '', sipPassword: data.sip_password || '', server: 'sip.telnyx.com', transport: 'TLS or UDP' },
  };
}

async function requireManagedCredentialResource(id: string) {
  const cached = credentialCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return { parsed: cached.parsed, data: cached.data };
  const stored = await readExtensionCredential(id);
  if (stored?.sipUsername && stored.sipPassword && stored.provider !== 'freeswitch') {
    const data: CredentialResource = {
      id,
      name: encodeName(stored.extension),
      tag: extensionTag,
      resource_id: connectionResource(),
      sip_username: stored.sipUsername,
      sip_password: stored.sipPassword,
      expired: stored.extension.status === 'expired',
      created_at: stored.extension.createdAt,
    };
    credentialCache.set(id, { expiresAt: Date.now() + 60_000, parsed: stored.extension, data });
    return { parsed: stored.extension, data };
  }
  const response = await telnyx(`/telephony_credentials/${encodeURIComponent(id)}`);
  const payload = await response.json() as { data?: CredentialResource };
  const data = payload.data;
  const parsed = data ? parseCredential(data) : null;
  if (!data || !parsed) throw new Error('Extension not found.');
  if (data.sip_username && data.sip_password) {
    await saveExtensionCredential({ extension: parsed, sipUsername: data.sip_username, sipPassword: data.sip_password });
  }
  await replaceStoredExtension(parsed);
  credentialCache.set(id, { expiresAt: Date.now() + 60_000, parsed, data });
  return { parsed, data };
}

async function requireManagedCredential(id: string) { return (await requireManagedCredentialResource(id)).parsed; }

export async function getExtension(id: string) {
  const stored = (await listExtensions()).find((item) => item.id === id);
  return stored || requireManagedCredential(id);
}

export async function getExtensionCredentials(id: string) {
  const config = await readPbxConfig();
  const stored = await readExtensionCredential(id);
  if (voiceProvider(config) === 'freeswitch') {
    const extension = stored?.extension || await getExtension(id);
    const sipDomain = organizationSipDomain(config, extension.organizationId);
    if (stored?.provider === 'freeswitch' && stored.sipUsername && stored.sipPassword) {
      return { extension: { ...extension, sipProvider: 'freeswitch' as const }, sipUsername: stored.sipUsername, sipPassword: stored.sipPassword, sipDomain, provider: 'freeswitch' as const };
    }
    const migrated = { ...extension, sipUsername: extension.extension, sipProvider: 'freeswitch' as const };
    const sipPassword = randomBytes(32).toString('base64url');
    await Promise.all([
      replaceStoredExtension(migrated),
      saveExtensionCredential({ extension: migrated, sipUsername: migrated.sipUsername, sipPassword, provider: 'freeswitch', sipDomain }),
    ]);
    return { extension: migrated, sipUsername: migrated.sipUsername, sipPassword, sipDomain, provider: 'freeswitch' as const };
  }
  const { parsed: extension, data } = await requireManagedCredentialResource(id);
  if (!data?.sip_username || !data.sip_password) throw new Error('Telnyx did not return extension credentials.');
  return { extension: { ...extension, sipProvider: 'telnyx' as const }, sipUsername: data.sip_username, sipPassword: data.sip_password, sipDomain: 'sip.telnyx.com', provider: 'telnyx' as const };
}

export async function updateExtension(id: string, input: Partial<ExtensionUser>) {
  const existing = await getExtension(id);
  const value = validateExtensionInput({ ...existing, ...input }, clean(input.extension, 5) || existing.extension);
  const config = await readPbxConfig();
  const organization = config.organizations.find((item) => item.id === value.organizationId && item.status === 'active');
  if (!organization) throw new Error('Organization is not active.');
  const numeric = Number(value.extension);
  const extensionChanged = value.extension !== existing.extension || value.organizationId !== existing.organizationId;
  if (extensionChanged && (numeric < organization.extensionStart || numeric > organization.extensionEnd)) throw new Error(`Extension must be between ${organization.extensionStart} and ${organization.extensionEnd}.`);
  const duplicate = (await listExtensions(value.organizationId)).find((item) => item.extension === value.extension && item.id !== id);
  if (duplicate) throw new Error(`Extension ${value.extension} already exists.`);
  const stored = await readExtensionCredential(id);
  if (stored?.provider === 'freeswitch' || voiceProvider(config) === 'freeswitch') {
    const extension: ExtensionUser = { ...value, id, sipUsername: value.extension, sipProvider: 'freeswitch', status: existing.status, createdAt: existing.createdAt };
    const sipPassword = stored?.provider === 'freeswitch' ? stored.sipPassword : randomBytes(32).toString('base64url');
    const sipDomain = organizationSipDomain(config, extension.organizationId);
    credentialCache.delete(id);
    await Promise.all([
      replaceStoredExtension(extension),
      saveExtensionCredential({ extension, sipUsername: extension.sipUsername, sipPassword, provider: 'freeswitch', sipDomain }),
      revokeExtensionSessions(id),
    ]);
    return extension;
  }
  const response = await telnyx(`/telephony_credentials/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name: encodeName(value), tag: extensionTag }) });
  const payload = await response.json() as { data?: CredentialResource };
  const mergedData: CredentialResource | undefined = payload.data ? { ...dataFor(existing, id), ...payload.data, tag: extensionTag, resource_id: connectionResource() } : undefined;
  const extension = mergedData ? parseCredential(mergedData) : null;
  credentialCache.delete(id);
  if (extension) {
    await Promise.all([
      replaceStoredExtension(extension),
      mergedData?.sip_username && mergedData.sip_password
        ? saveExtensionCredential({ extension, sipUsername: mergedData.sip_username, sipPassword: mergedData.sip_password })
        : Promise.resolve(),
    ]);
  } else {
    invalidateExtensionCache();
  }
  await revokeExtensionSessions(id);
  return extension;
}

function dataFor(extension: ExtensionUser, id: string): CredentialResource {
  const cached = credentialCache.get(id)?.data;
  return {
    id,
    name: encodeName(extension),
    tag: extensionTag,
    resource_id: connectionResource(),
    sip_username: cached?.sip_username || extension.sipUsername,
    sip_password: cached?.sip_password,
    expired: extension.status === 'expired',
    created_at: extension.createdAt,
  };
}

export async function deleteExtension(id: string) {
  const stored = await readExtensionCredential(id);
  if (!stored) await requireManagedCredential(id);
  await revokeExtensionSessions(id);
  if (stored?.provider !== 'freeswitch') await telnyx(`/telephony_credentials/${encodeURIComponent(id)}`, { method: 'DELETE' });
  credentialCache.delete(id);
  await Promise.all([replaceStoredExtension(null, id), deleteExtensionCredential(id)]);
}

export async function findExtension(number: string, organizationId?: string) {
  return (await listExtensions(organizationId)).find((item) => item.extension === number && item.status === 'active') ?? null;
}

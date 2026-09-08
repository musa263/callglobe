import { randomUUID } from 'node:crypto';
import type { ExtensionUser } from './pbx.js';
import { readPbxConfig } from './pbx-config-store.js';
import { readExtensionDirectoryState, updateExtensionDirectory } from './extension-store.js';
import { revokeExtensionSessions } from './extension-session-store.js';
import { sipInboundEnabled, voiceEdge } from '../calling/voice-provider.js';

export function assertVocivoExtensionEngine(edge = voiceEdge(), inbound = sipInboundEnabled()) {
  if (edge !== 'sip' || !inbound) throw new Error('Vocivo extension authority requires SIP app calling and SIP inbound routing.');
}

export async function vocivoExtensionsEnabled() {
  const directory = await readExtensionDirectoryState();
  if (directory?.authority !== 'vocivo') return false;
  // A setting rollback must not silently resurrect carrier identities or mint carrier tokens.
  assertVocivoExtensionEngine();
  return true;
}

const dependencies = {
  readDirectory: readExtensionDirectoryState,
  updateDirectory: (update: Parameters<typeof updateExtensionDirectory>[0]) => updateExtensionDirectory(update, undefined, 'vocivo'),
  readConfig: readPbxConfig,
  revoke: revokeExtensionSessions,
  newId: randomUUID as () => string,
};

function text(value: unknown, max: number) {
  return typeof value === 'string' ? value.replace(/[|\r\n]/g, ' ').trim().slice(0, max) : '';
}

function role(value: unknown): ExtensionUser['role'] {
  if (value === 'owner' || value === 'company_owner') return 'company_owner';
  if (value === 'admin' || value === 'company_admin') return 'company_admin';
  if (value === 'manager' || value === 'individual') return value;
  return 'user';
}

function fields(input: Partial<ExtensionUser>) {
  const name = text(input.name, 50);
  if (!name) throw new Error('Extension name is required.');
  if (input.status !== undefined && !['active', 'expired'].includes(input.status)) throw new Error('Invalid extension status.');
  // Explicit allowlist: request bodies can also contain loginPassword and carrier identities.
  return { name, department: text(input.department, 30) || 'General', email: text(input.email, 70),
    mobile: text(input.mobile, 24), role: role(input.role), status: input.status || 'active' as const };
}

function owned(rows: ExtensionUser[], id: string, organizationId?: string) {
  const item = rows.find((row) => row.id === id && (!organizationId || row.organizationId === organizationId));
  if (!item) throw new Error('Extension not found.');
  return item;
}

export function createVocivoExtensionService(deps = dependencies) {
  async function list(organizationId?: string) {
    const stored = await deps.readDirectory();
    if (stored?.authority !== 'vocivo') throw new Error('Vocivo extension directory migration is required.');
    return stored.extensions.filter((item) => !organizationId || item.organizationId === organizationId);
  }
  async function get(id: string, organizationId?: string) { return owned(await list(), id, organizationId); }
  async function organization(id: string) {
    const config = await deps.readConfig();
    const item = config.organizations.find((entry) => entry.id === id && entry.status === 'active');
    if (!item) throw new Error('Organization is not active.');
    if (!Number.isInteger(item.extensionStart) || !Number.isInteger(item.extensionEnd)
      || item.extensionStart < 10 || item.extensionEnd > 99999 || item.extensionEnd < item.extensionStart
      || item.extensionEnd - item.extensionStart > 9999) throw new Error('Organization extension range is invalid.');
    return item;
  }
  return {
    list, get,
    async create(input: Partial<ExtensionUser>) {
      const tenant = await organization(text(input.organizationId, 50));
      const attributes = fields(input);
      const id = deps.newId();
      const sipUsername = `vocivo_${deps.newId().replace(/-/g, '')}`;
      const requested = input.extension === undefined || input.extension === '' ? '' : text(input.extension, 5);
      if (input.extension && (input.extension !== requested || !/^\d{2,5}$/.test(requested))) throw new Error('Extension must contain 2 to 5 digits.');
      const rows = await deps.updateDirectory((latest) => {
        const used = latest.filter((item) => item.organizationId === tenant.id);
        const number = requested || Array.from({ length: tenant.extensionEnd - tenant.extensionStart + 1 }, (_, index) => String(tenant.extensionStart + index))
          .find((candidate) => !used.some((item) => item.extension === candidate));
        if (!number) throw new Error('This organization has no available extension slots.');
        if (Number(number) < tenant.extensionStart || Number(number) > tenant.extensionEnd) throw new Error('Extension is outside the organization range.');
        if (used.some((item) => item.extension === number)) throw new Error('Extension already exists.');
        const extension: ExtensionUser = { ...attributes, id, sipUsername, extension: number, organizationId: tenant.id,
          role: tenant.accountType === 'individual' ? 'individual' : attributes.role,
          sipProvider: 'vocivo', createdAt: new Date().toISOString() };
        return [...latest, extension].sort((a, b) => Number(a.extension) - Number(b.extension));
      });
      return { extension: owned(rows, id, tenant.id) };
    },
    async update(id: string, input: Partial<ExtensionUser>, organizationId?: string) {
      const existing = await get(id, organizationId);
      if (input.organizationId !== undefined && input.organizationId !== existing.organizationId) throw new Error('Extension organization cannot be changed.');
      const tenant = await organization(existing.organizationId);
      await deps.revoke(id);
      const rows = await deps.updateDirectory((latest) => {
        const current = owned(latest, id, existing.organizationId);
        const number = input.extension === undefined ? current.extension : input.extension;
        if (typeof number !== 'string' || !/^\d{2,5}$/.test(number)) throw new Error('Extension must contain 2 to 5 digits.');
        if (number !== current.extension && (Number(number) < tenant.extensionStart || Number(number) > tenant.extensionEnd)) throw new Error('Extension is outside the organization range.');
        if (latest.some((item) => item.id !== id && item.organizationId === tenant.id && item.extension === number)) throw new Error('Extension already exists.');
        const attributes = fields({ ...current, ...input });
        const next: ExtensionUser = { ...current, ...attributes, extension: number,
          role: tenant.accountType === 'individual' ? 'individual' : attributes.role };
        return latest.map((item) => item.id === id ? next : item).sort((a, b) => Number(a.extension) - Number(b.extension));
      });
      return owned(rows, id, tenant.id);
    },
    async remove(id: string, organizationId?: string) {
      const existing = await get(id, organizationId);
      await deps.revoke(id);
      await deps.updateDirectory((latest) => {
        owned(latest, id, existing.organizationId);
        return latest.filter((item) => item.id !== id);
      });
      // Historical carrier credentials remain archived, never used by this service.
      // Device grants are rejected by session revocation and current-directory checks.
    },
  };
}

export const vocivoExtensions = createVocivoExtensionService();

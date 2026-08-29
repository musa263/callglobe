import type { VocivoSession } from './auth.js';
import { readPbxConfig, savePbxConfig, type PbxConfig } from './pbx-config-store.js';

export function normalizeE164(value: unknown) {
  return typeof value === 'string' ? value.replace(/[\s()-]/g, '') : '';
}

export function sessionOrganizationId(session: VocivoSession, config: PbxConfig) {
  const organizationId = session.organizationId?.trim();
  if (!organizationId || !config.organizations.some((organization) => organization.id === organizationId && organization.status === 'active')) {
    throw new Error('Unauthorized');
  }
  return organizationId;
}

export function numberOrganizationId(phoneNumber: string, config: PbxConfig) {
  return config.numberAssignments[normalizeE164(phoneNumber)]?.organizationId || '';
}

export function sessionCanAccessNumber(session: VocivoSession, phoneNumber: string, config: PbxConfig) {
  return session.sub === 'vocivo-owner' || numberOrganizationId(phoneNumber, config) === sessionOrganizationId(session, config);
}

export function organizationForInboundNumber(phoneNumber: string, config: PbxConfig) {
  const assigned = numberOrganizationId(phoneNumber, config);
  return assigned && config.organizations.some((organization) => organization.id === assigned && organization.status === 'active') ? assigned : '';
}

export async function organizationForNumber(phoneNumber: string) {
  const config = await readPbxConfig();
  return organizationForInboundNumber(phoneNumber, config);
}

export async function assignNumberToOrganization(phoneNumber: string, organizationId: string, patch: Omit<PbxConfig['numberAssignments'][string], 'organizationId'> = {}) {
  const normalized = normalizeE164(phoneNumber);
  await savePbxConfig((config) => {
    if (!config.organizations.some((item) => item.id === organizationId)) throw new Error('Organization not found.');
    return { numberAssignments: { ...config.numberAssignments, [normalized]: { ...config.numberAssignments[normalized], ...patch, organizationId } } };
  });
}

export async function removeNumberAssignment(phoneNumber: string) {
  const normalized = normalizeE164(phoneNumber);
  await savePbxConfig((config) => {
    const numberAssignments = { ...config.numberAssignments };
    delete numberAssignments[normalized];
    return { numberAssignments };
  });
}

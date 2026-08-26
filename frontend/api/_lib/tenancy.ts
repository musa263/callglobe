import type { VocivoSession } from './auth.js';
import { readPbxConfig, savePbxConfig, type PbxConfig } from './pbx-config-store.js';

export function normalizeE164(value: unknown) {
  return typeof value === 'string' ? value.replace(/[\s()-]/g, '') : '';
}

export function primaryOrganizationId(config: PbxConfig) {
  return config.organizations[0]?.id || 'primary';
}

export function sessionOrganizationId(session: VocivoSession, config: PbxConfig) {
  return session.organizationId || config.activeOrganizationId || primaryOrganizationId(config);
}

export function numberOrganizationId(phoneNumber: string, config: PbxConfig) {
  return config.numberAssignments[normalizeE164(phoneNumber)]?.organizationId || '';
}

export function sessionCanAccessNumber(session: VocivoSession, phoneNumber: string, config: PbxConfig) {
  return session.sub === 'vocivo-owner' || numberOrganizationId(phoneNumber, config) === sessionOrganizationId(session, config);
}

export async function organizationForNumber(phoneNumber: string) {
  const config = await readPbxConfig();
  return numberOrganizationId(phoneNumber, config);
}

export async function assignNumberToOrganization(phoneNumber: string, organizationId: string, patch: Omit<PbxConfig['numberAssignments'][string], 'organizationId'> = {}) {
  const normalized = normalizeE164(phoneNumber);
  const config = await readPbxConfig();
  if (!config.organizations.some((item) => item.id === organizationId)) throw new Error('Organization not found.');
  await savePbxConfig({ numberAssignments: { ...config.numberAssignments, [normalized]: { ...config.numberAssignments[normalized], ...patch, organizationId } } });
}

export async function removeNumberAssignment(phoneNumber: string) {
  const normalized = normalizeE164(phoneNumber);
  const config = await readPbxConfig();
  const numberAssignments = { ...config.numberAssignments };
  delete numberAssignments[normalized];
  await savePbxConfig({ numberAssignments });
}

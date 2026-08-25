import type { VocivoSession } from './auth.js';
import { readPbxConfig, type PbxConfig } from './pbx-config-store.js';
import { effectiveEntitlements, readSaasState, type FeatureKey } from './saas-store.js';

export async function accessForSession(session: VocivoSession, config?: PbxConfig) {
  if (session.sub === 'vocivo-owner' && session.role === 'superadmin') return { superadmin: true as const };
  const pbx = config || await readPbxConfig();
  return accessForOrganization(session.organizationId || '', pbx);
}

export async function accessForOrganization(organizationId: string, config?: PbxConfig) {
  const pbx = config || await readPbxConfig();
  const organization = pbx.organizations.find((item) => item.id === organizationId);
  if (!organization || organization.status !== 'active') throw new Error('Organization inactive');
  const access = effectiveEntitlements(await readSaasState(pbx), organization.id, organization.accountType);
  if (!access.serviceActive) throw new Error('Subscription inactive');
  return { superadmin: false as const, organization, ...access };
}

export async function requireFeature(session: VocivoSession, feature: FeatureKey, config?: PbxConfig) {
  const access = await accessForSession(session, config);
  if (!access.superadmin && !access.features[feature]) throw new Error('Feature not enabled');
  return access;
}

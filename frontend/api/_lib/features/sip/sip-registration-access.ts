import { readCurrentExtension } from '../organizations/extension-identity.js';
import { isExtensionSessionRevoked } from '../organizations/extension-session-store.js';
import { readPbxConfig } from '../organizations/pbx-config-store.js';
import { activeTenantAdmin, effectiveEntitlements, readTenantSaasState } from '../organizations/saas-store.js';
import type { StoredSipCredential } from './sip-credential-store.js';

const dependencies = { readCurrentExtension, readPbxConfig, readTenantSaasState, activeTenantAdmin, isExtensionSessionRevoked };

/** Registration never provisions carrier credentials or trusts cached JWT roles. */
export function createSipRegistrationAccess(deps = dependencies) {
  return async (credential: StoredSipCredential): Promise<boolean> => {
    const config = await deps.readPbxConfig();
    const organization = config.organizations.find((item) => item.id === credential.organizationId && item.status === 'active');
    if (!organization) return false;
    const extension = await deps.readCurrentExtension(credential.extensionId);
    if (!extension || extension.organizationId !== organization.id || extension.status !== 'active' || extension.sipUsername !== credential.username) return false;
    const issuedAt = credential.sessionIssuedAt ?? Date.parse(credential.issuedAt || '') / 1000;
    if (!Number.isFinite(issuedAt) || issuedAt <= 0 || await deps.isExtensionSessionRevoked(extension.id, issuedAt, { fresh: true })) return false;
    if (credential.accountId) {
      const admin = await deps.activeTenantAdmin(credential.accountId, organization.id, config);
      if (!admin || admin.extensionId !== extension.id || admin.forcePasswordChange) return false;
    }
    const state = await deps.readTenantSaasState(organization.id, config);
    const subscription = state.subscriptions[organization.id];
    if (!subscription || subscription.organizationId !== organization.id || !state.plans.some((plan) => plan.id === subscription.planId)) return false;
    const access = effectiveEntitlements(state, organization.id, organization.accountType);
    return access.serviceActive && (access.features.internalCalling || access.features.outboundCalling);
  };
}

export const sipRegistrationAllowed = createSipRegistrationAccess();

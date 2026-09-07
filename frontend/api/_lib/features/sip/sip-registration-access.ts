import { readCurrentExtension } from '../organizations/extension-identity.js';
import { isExtensionSessionRevoked } from '../organizations/extension-session-store.js';
import { readPbxConfig } from '../organizations/pbx-config-store.js';
import { effectiveEntitlements, readTenantSaasState } from '../organizations/saas-store.js';
import type { StoredSipCredential } from './sip-credential-store.js';

const dependencies = { readCurrentExtension, readPbxConfig, readTenantSaasState, isExtensionSessionRevoked };

/** Registration never provisions carrier credentials or trusts cached JWT roles. */
export function createSipRegistrationAccess(deps = dependencies) {
  return async (credential: StoredSipCredential): Promise<boolean> => {
    const [config, extension] = await Promise.all([deps.readPbxConfig(), deps.readCurrentExtension(credential.extensionId)]);
    const organization = config.organizations.find((item) => item.id === credential.organizationId && item.status === 'active');
    if (!organization) return false;
    if (!extension || extension.organizationId !== organization.id || extension.status !== 'active' || extension.sipUsername !== credential.username) return false;
    const issuedAt = credential.sessionIssuedAt ?? Date.parse(credential.issuedAt || '') / 1000;
    if (!Number.isFinite(issuedAt) || issuedAt <= 0) return false;
    // REGISTER is a read-only authorization path. Cold instances must not run
    // schema DDL/bootstrap or read the same tenant state again for its admin.
    const [revoked, state] = await Promise.all([
      deps.isExtensionSessionRevoked(extension.id, issuedAt, { fresh: true }),
      deps.readTenantSaasState(organization.id, config, { initialize: false }),
    ]);
    if (revoked) return false;
    if (credential.accountId) {
      const admin = state.tenantAdmins.find((item) => item.id === credential.accountId
        && item.organizationId === organization.id && item.status === 'active');
      if (!admin || admin.extensionId !== extension.id || admin.forcePasswordChange) return false;
    }
    const subscription = state.subscriptions[organization.id];
    if (!subscription || subscription.organizationId !== organization.id || !state.plans.some((plan) => plan.id === subscription.planId)) return false;
    const access = effectiveEntitlements(state, organization.id, organization.accountType);
    return access.serviceActive && (access.features.internalCalling || access.features.outboundCalling);
  };
}

export const sipRegistrationAllowed = createSipRegistrationAccess();

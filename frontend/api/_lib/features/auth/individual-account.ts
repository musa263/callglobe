import { randomUUID } from 'node:crypto';
import { createExtension, getExtension } from '../organizations/pbx.js';
import { readPbxConfig, savePbxConfig } from '../organizations/pbx-config-store.js';
import { createSubscription, defaultSaasState, effectiveEntitlements, readSignupPlans, readTenantSaasState, saveSaasSubscription } from '../organizations/saas-store.js';
import { phoneAuthStore, phoneIdentityHash } from './phone-auth-store.js';
import { PhoneAuthError } from './phone-otp.js';

type Identity = { organizationId: string; extensionId?: string; state: 'provisioning' | 'ready'; operationId: string };

export async function individualAccount(phone: string, name: string, planId: string) {
  const plans = await readSignupPlans();
  const plan = plans.find((candidate) => candidate.id === planId && candidate.active);
  if (!plan || plan.monthlyPrice !== 0) throw new PhoneAuthError('Individual signup is not configured. Please contact Vocivo support.', 503);
  const operationId = randomUUID();
  const organizationId = randomUUID();
  const key = `identity/${phoneIdentityHash(phone)}`;
  const identity = await phoneAuthStore.mutate<Identity>(key, (current) => current || { organizationId, operationId, state: 'provisioning' });
  if (identity.state === 'provisioning') {
    // Never retry an ambiguous carrier creation automatically. A crash/timeout is reconciled
    // by operations against this stable organization ID, not a second billable credential.
    if (identity.operationId !== operationId) throw new PhoneAuthError('Your account setup needs attention. Please contact Vocivo support.', 409);
    let config = await readPbxConfig();
    const state = { ...defaultSaasState(), plans };
    config = await savePbxConfig((current) => ({ organizations: [...current.organizations, {
      id: identity.organizationId, name, slug: `personal-${identity.organizationId}`, ownerDisplayName: name, ownerEmail: '',
      accountType: 'individual', internalCallingEnabled: false, extensionStart: 90000, extensionEnd: 90000, status: 'active',
    }] }));
    await saveSaasSubscription(identity.organizationId, createSubscription(identity.organizationId, plan.id, state), config);
    const { extension } = await createExtension({ organizationId: identity.organizationId, extension: '90000', name, mobile: phone, email: '', role: 'individual' });
    await phoneAuthStore.mutate<Identity>(key, (current) => {
      if (current?.operationId !== operationId) throw new Error('Personal identity provisioning conflict.');
      return { ...current, extensionId: extension.id, state: 'ready' };
    });
    identity.extensionId = extension.id;
  }
  const config = await readPbxConfig();
  const organization = config.organizations.find((item) => item.id === identity.organizationId && item.accountType === 'individual' && item.status === 'active');
  if (!organization || !identity.extensionId) throw new PhoneAuthError('This individual account is unavailable.', 403);
  const extension = await getExtension(identity.extensionId, organization.id);
  if (extension.role !== 'individual' || extension.status !== 'active') throw new PhoneAuthError('This individual account is unavailable.', 403);
  const access = effectiveEntitlements(await readTenantSaasState(organization.id, config), organization.id, 'individual');
  return { extension, organization, access };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSipRegistrationAccess } from './sip-registration-access.js';
import { defaultPbxConfig } from '../organizations/pbx-config-store.js';
import { defaultSaasState } from '../organizations/saas-store.js';
import type { ExtensionUser } from '../organizations/pbx.js';
import type { StoredSipCredential } from './sip-credential-store.js';

function fixture() {
  const config = defaultPbxConfig();
  const org = config.organizations[0];
  assert.ok(org);
  const state = defaultSaasState(config);
  const extension: ExtensionUser = { id: 'employee', organizationId: org.id, extension: '2001',
    name: 'Test User', email: '', mobile: '', department: '', role: 'user', sipUsername: 'sip-user', status: 'active' };
  let directory: ExtensionUser[] | null = [extension];
  let revoked = false;
  let tenantReads = 0;
  const credential: StoredSipCredential = { username: extension.sipUsername, organizationId: org.id,
    extensionId: extension.id, realm: 'sip.example', ha1: 'not-used', expiresAt: new Date(Date.now() + 60000).toISOString(),
    issuedAt: new Date().toISOString(), sessionIssuedAt: 1234 };
  const allowed = createSipRegistrationAccess({
    readPbxConfig: async () => config,
    readCurrentExtension: async (id) => directory?.find((item) => item.id === id) || null,
    readTenantSaasState: async (id, _config, options) => { tenantReads++; assert.equal(id, org.id); assert.equal(options?.initialize, false); return state; },
    isExtensionSessionRevoked: async (id, issuedAt, options) => {
      assert.equal(id, extension.id); assert.equal(issuedAt, 1234); assert.equal(options?.fresh, true);
      return revoked;
    },
  });
  return { config, org, state, extension, credential, allowed, get tenantReads() { return tenantReads; },
    deleteDirectory: () => { directory = null; }, revoke: () => { revoked = true; } };
}

test('REGISTER checks current tenant, employee, subscription and uncached revocation without carrier provisioning', async () => {
  const f = fixture();
  assert.equal(await f.allowed(f.credential), true);
  f.revoke();
  assert.equal(await f.allowed(f.credential), false);
});

for (const scenario of ['tenant', 'employee', 'deleted', 'moved', 'username', 'subscription', 'missing-plan', 'missing-subscription', 'admin'] as const) {
  test(`REGISTER denies a valid digest after ${scenario} access is revoked or mismatched`, async () => {
    const f = fixture();
    if (scenario === 'tenant') f.org.status = 'suspended';
    if (scenario === 'employee') f.extension.status = 'expired';
    if (scenario === 'deleted') f.deleteDirectory();
    if (scenario === 'moved') f.extension.organizationId = 'another-tenant';
    if (scenario === 'username') f.extension.sipUsername = 'another-username';
    if (scenario === 'subscription') f.state.subscriptions[f.org.id].status = 'suspended';
    if (scenario === 'missing-plan') f.state.plans = [];
    if (scenario === 'missing-subscription') delete f.state.subscriptions[f.org.id];
    if (scenario === 'admin') f.credential.accountId = 'removed-admin';
    assert.equal(await f.allowed(f.credential), false);
  });
}


test('admin REGISTER uses one read-only tenant snapshot and still enforces admin ownership and password reset', async () => {
  const f = fixture();
  f.credential.accountId = 'owner';
  f.state.tenantAdmins = [{ id: 'owner', organizationId: f.org.id, extensionId: f.extension.id,
    email: 'owner@example.test', name: 'Owner', role: 'company_owner', passwordHash: 'unused',
    status: 'active', forcePasswordChange: false, createdAt: '', updatedAt: '' }];
  assert.equal(await f.allowed(f.credential), true);
  assert.equal(f.tenantReads, 1);
  f.state.tenantAdmins[0].forcePasswordChange = true;
  assert.equal(await f.allowed(f.credential), false);
  f.state.tenantAdmins[0].forcePasswordChange = false;
  f.state.tenantAdmins[0].organizationId = 'other';
  assert.equal(await f.allowed(f.credential), false);
});

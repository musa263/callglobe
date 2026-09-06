import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPbxConfig } from './pbx-config-store.js';
import { requestOrganizationId, TenantScopeError } from './request-organization.js';

const config = defaultPbxConfig();
config.organizations.push({ ...config.organizations[0], id: 'second', name: 'Second Company' });
const platform = { sub: 'vocivo-owner', role: 'superadmin' as const };

test('platform requests bind to an explicit workspace independent of shared selection', () => {
  const req = { method: 'PUT', query: { organizationId: 'primary' } };
  assert.equal(requestOrganizationId(req, platform, config), 'primary');
  assert.equal(requestOrganizationId(req, platform, { ...config, activeOrganizationId: 'second' }), 'primary');
});

test('only initial read may use a default; ambiguous platform writes fail closed', () => {
  assert.equal(requestOrganizationId({ method: 'GET', query: {} }, platform, config, { allowInitialRead: true }), config.activeOrganizationId);
  for (const method of ['GET', 'PUT', 'POST', 'PATCH', 'DELETE']) {
    assert.throws(() => requestOrganizationId({ method, query: {} }, platform, config), (e) => e instanceof TenantScopeError && e.status === 400);
  }
  assert.throws(() => requestOrganizationId({ method: 'PUT', query: {} }, platform, config, { allowInitialRead: true }), TenantScopeError);
});

test('company roles remain bound to their verified organization', () => {
  for (const role of ['company_owner', 'company_admin', 'user'] as const) {
    const session = { sub: 'vocivo-extension:one', role, organizationId: 'primary' };
    assert.equal(requestOrganizationId({ method: 'GET', query: {} }, session, config), 'primary');
    assert.throws(() => requestOrganizationId({ method: 'PUT', query: { organizationId: 'second' } }, session, config), (e) => e instanceof TenantScopeError && e.status === 403);
    assert.throws(() => requestOrganizationId({ method: 'GET', query: {} }, { ...session, organizationId: undefined }, config), /Unauthorized/);
  }
});

test('unknown, empty and repeated workspace parameters cannot select a default', () => {
  for (const value of ['', 'missing', ['primary', 'second']]) {
    assert.throws(() => requestOrganizationId({ method: 'GET', query: { organizationId: value } }, platform, config, { allowInitialRead: true }), TenantScopeError);
  }
  assert.throws(() => requestOrganizationId({ method: 'GET', query: { organizationId: 'second' } }, { ...platform, sub: 'vocivo-extension:one', organizationId: 'primary' }, config), TenantScopeError);
});

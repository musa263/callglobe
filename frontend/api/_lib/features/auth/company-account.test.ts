import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAccessForSession, createTenantAdminSession, requireSession } from './auth.js';
import { accountCredentialVersion, assertAccountCredentialVersion, assertCompanyAccountIdentity, hasActiveAdministrator } from './company-account.js';
import { createAdminExtensionsHandler } from '../organizations/routes/admin-extensions.js';
import { defaultPbxConfig } from '../organizations/pbx-config-store.js';
import type { ExtensionUser } from '../organizations/pbx.js';
import type { TenantAdminAccount } from '../organizations/saas-store.js';

process.env.AUTH_SECRET = 'test-company-account-secret';
function fixture() {
  const config = defaultPbxConfig();
  const users: ExtensionUser[] = [];
  const accounts: TenantAdminAccount[] = [{ id: 'owner', organizationId: 'primary', role: 'company_owner', status: 'active' } as TenantAdminAccount];
  let role: 'company_admin' | 'user' = 'company_admin';
  const deps = {
    requireAdmin: async () => adminAccessForSession({ sub: 'vocivo-account:actor', role, organizationId: 'primary', accountId: 'actor', extensionId: 'actor-ext' }),
    readPbxConfig: async () => config,
    accessForSession: async () => ({ superadmin: false, plan: { name: 'Business', limits: { seats: 10 } } }),
    listExtensions: async () => users,
    createExtension: async (input: Partial<ExtensionUser>) => { const user = { ...input, id: `user-${users.length}`, extension: `200${users.length + 1}`, status: 'active' } as ExtensionUser; users.push(user); return { extension: user }; },
    updateExtension: async (id: string, input: Partial<ExtensionUser>) => { const user = users.find(item => item.id === id)!; Object.assign(user, input); return user; },
    deleteExtension: async (id: string) => { users.splice(users.findIndex(item => item.id === id), 1); },
    findTenantAdminByEmail: async (email: string) => accounts.find(item => item.email === email.toLowerCase()) || null,
    findTenantAdminForExtension: async (id: string) => accounts.find(item => item.extensionId === id) || null,
    readTenantSaasState: async () => ({ tenantAdmins: accounts }),
    removeTenantAdminForExtension: async (id: string) => { const index = accounts.findIndex(item => item.extensionId === id); if (index >= 0) accounts.splice(index, 1); },
    saveTenantAdmin: async (input: Partial<TenantAdminAccount> & { password?: string }) => {
      const existing = accounts.find(item => item.extensionId === input.extensionId);
      const account = { ...existing, ...input, id: existing?.id || `account-${accounts.length}`, email: input.email?.toLowerCase(),
        passwordHash: input.password ? await bcrypt.hash(input.password, 4) : existing?.passwordHash } as TenantAdminAccount;
      if (existing) accounts.splice(accounts.indexOf(existing), 1);
      accounts.push(account); return account;
    },
  };
  const handler = createAdminExtensionsHandler(deps as unknown as Parameters<typeof createAdminExtensionsHandler>[0]);
  async function request(method: string, body: object, query = {}) {
    let status = 200, payload: any;
    const response = { setHeader() {}, status(value: number) { status = value; return this; }, json(value: unknown) { payload = value; return this; } };
    await handler({ method, body, query, headers: {}, url: '/api/admin/extensions' } as VercelRequest, response as unknown as VercelResponse);
    return { status, payload };
  }
  return { config, users, accounts, request, setActorRole: (value: typeof role) => { role = value; } };
}
const employee = { name: 'Example Employee', role: 'user', email: 'employee@example.invalid', loginPassword: 'TemporaryPass65' };

test('company administrator creates an employee login that cannot administer the company', async () => {
  const f = fixture();
  const created = await f.request('POST', employee);
  assert.equal(created.status, 201);
  const account = f.accounts[1];
  assert.equal(account.role, 'user'); assert.equal(account.forcePasswordChange, true);
  assert.equal(await bcrypt.compare(employee.loginPassword, account.passwordHash), true);
  const deps = { readPbxConfig: async () => f.config, activeTenantAdmin: async () => account,
    readCurrentExtension: async () => f.users[0], isExtensionSessionRevoked: async () => false };
  const token = await createTenantAdminSession(account);
  const req = { headers: { authorization: `Bearer ${token}` }, url: '/api/mobile/bootstrap' } as VercelRequest;
  await assert.rejects(requireSession(req, deps), /Password change required/);
  account.forcePasswordChange = false;
  const session = await requireSession(req, deps);
  assert.equal(session.role, 'user'); assert.equal(session.organizationId, 'primary');
  assert.throws(() => adminAccessForSession(session), /Forbidden/);
  account.passwordHash = await bcrypt.hash('ChangedPassword65', 4);
  await assert.rejects(requireSession(req, deps), /Unauthorized/);
});

test('creation refuses role escalation, foreign workspaces, duplicate email and weak credentials', async () => {
  const f = fixture();
  assert.equal((await f.request('POST', { ...employee, role: 'owner' })).status, 403);
  assert.equal((await f.request('POST', { ...employee, organizationId: 'foreign' })).status, 409);
  assert.equal((await f.request('POST', { ...employee, loginPassword: 'weak' })).status, 400);
  assert.equal((await f.request('POST', { ...employee, loginPassword: `Aa1${'x'.repeat(70)}` })).status, 400);
  assert.equal((await f.request('POST', { ...employee, loginPassword: `Aa1${'é'.repeat(35)}` })).status, 400);
  f.accounts.push({ email: employee.email, organizationId: 'foreign' } as TenantAdminAccount);
  assert.equal((await f.request('POST', employee)).status, 409);
  assert.equal(f.users.length, 0);
  f.setActorRole('user');
  assert.equal((await f.request('POST', employee)).status, 403);
});

test('employees never satisfy the last-administrator safeguard and account identity must stay current', () => {
  assert.equal(hasActiveAdministrator([{ role: 'user', status: 'active' }, { role: 'manager', status: 'active' }]), false);
  const account = { role: 'user', organizationId: 'primary', extensionId: 'u', extension: '2001' };
  const extension = { id: 'u', organizationId: 'primary', extension: '2001', role: 'user', status: 'active' } as ExtensionUser;
  assert.doesNotThrow(() => assertCompanyAccountIdentity(account, extension));
  for (const change of [{ status: 'suspended' }, { organizationId: 'foreign' }, { role: 'company_admin' }, { extension: '2002' }]) {
    assert.throws(() => assertCompanyAccountIdentity(account, { ...extension, ...change } as ExtensionUser), /Unauthorized/);
  }
  assert.throws(() => assertCompanyAccountIdentity(account, null), /Unauthorized/);
  assert.throws(() => assertAccountCredentialVersion(undefined, { role: 'user', passwordHash: 'hash' }), /Unauthorized/);
  assert.doesNotThrow(() => assertAccountCredentialVersion(accountCredentialVersion('hash'), { role: 'user', passwordHash: 'hash' }));
});

test('reset and deletion stay scoped to the selected employee', async () => {
  const f = fixture(); await f.request('POST', employee);
  const id = f.users[0].id;
  assert.equal((await f.request('PATCH', { id, role: 'manager', loginPassword: 'AnotherPassword65' })).status, 200);
  assert.equal(f.accounts[1].role, 'manager');
  assert.equal(await bcrypt.compare('AnotherPassword65', f.accounts[1].passwordHash), true);
  assert.equal((await f.request('DELETE', { id })).status, 200);
  assert.equal(f.users.length, 0); assert.equal(f.accounts.length, 1);
});

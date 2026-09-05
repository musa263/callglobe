import assert from 'node:assert/strict';
import test from 'node:test';
import { mayAdministerAccount, mayGrantAdminAccess } from './admin-account-access.js';

const superadmin = { superadmin: true, role: 'owner' };
const companyOwner = { superadmin: false, role: 'company_owner', extensionId: 'ext-owner' };
const companyAdmin = { superadmin: false, role: 'company_admin', extensionId: 'ext-admin' };

const owner = { id: 'ext-owner', role: 'company_owner' };
const admin = { id: 'ext-admin', role: 'company_admin' };
const otherAdmin = { id: 'ext-admin-2', role: 'company_admin' };
const user = { id: 'ext-user', role: 'user' };

test('only the company owner hands out administrator access', () => {
  assert.equal(mayGrantAdminAccess(companyOwner, 'company_admin'), true);
  assert.equal(mayGrantAdminAccess(companyAdmin, 'company_admin'), false);
  assert.equal(mayGrantAdminAccess(companyAdmin, 'company_owner'), false);
  assert.equal(mayGrantAdminAccess(superadmin, 'company_owner'), true);
});

test('a request that names no role is not a request for administrator access', () => {
  assert.equal(mayGrantAdminAccess(companyAdmin, undefined), true);
  assert.equal(mayGrantAdminAccess(companyAdmin, 'user'), true);
});

test('an administrator cannot change the owner, which is how a request with no role took the account', () => {
  // The password reset that made this a takeover: PATCH the owner's extension
  // with a loginPassword and no role at all.
  assert.equal(mayAdministerAccount(companyAdmin, owner), false);
  assert.equal(mayAdministerAccount(companyAdmin, otherAdmin), false);
  assert.equal(mayAdministerAccount(companyOwner, admin), true);
  assert.equal(mayAdministerAccount(superadmin, owner), true);
});

test('an administrator still manages ordinary users, and their own account', () => {
  assert.equal(mayAdministerAccount(companyAdmin, user), true);
  assert.equal(mayAdministerAccount(companyAdmin, admin), true);
});

test('a session with no extension of its own matches nobody by identity', () => {
  assert.equal(mayAdministerAccount({ superadmin: false, role: 'company_admin' }, { id: '', role: 'company_admin' }), false);
});

test('the role aliases the store accepts are administrator roles once normalised', async () => {
  // admin-extensions must normalise before asking mayGrantAdminAccess: the
  // raw alias "owner" is not an admin role to the guard, but is saved as one.
  const { normalizeRole } = await import('../organizations/pbx.js');
  const { isAdminRole, mayGrantAdminAccess } = await import('./admin-account-access.js');
  assert.equal(isAdminRole('owner'), false);
  assert.equal(isAdminRole(normalizeRole('owner')), true);
  assert.equal(isAdminRole(normalizeRole('admin')), true);
  assert.equal(mayGrantAdminAccess({ superadmin: false, role: 'company_admin' }, normalizeRole('owner')), false);
});

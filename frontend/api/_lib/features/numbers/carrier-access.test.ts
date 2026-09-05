import assert from 'node:assert/strict';
import test from 'node:test';
import { createExtensionSession, createTenantAdminSession, requireOwner, requireSession } from '../auth/auth.js';

test('platform carrier credentials reject a company extension session', async () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'carrier-access-test-secret-that-is-long-enough';
  try {
    const employee = await createTenantAdminSession({
      id: 'account-a',
      organizationId: 'company-a',
      email: 'admin@company.test',
      name: 'Company Admin',
      role: 'company_admin',
      passwordHash: 'unused',
      status: 'active',
      forcePasswordChange: false,
      extensionId: 'extension-a',
      extension: '2000',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });
    // Tenant rejection happens before owner revocation-store access. A real
    // owner must pass that database check, covered by auth-revocation.test.ts.
    await assert.rejects(() => requireOwner({ headers: { authorization: `Bearer ${employee}` } } as never), /Forbidden/);
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous;
  }
});

test('extension sessions without an organization claim fail before tenant lookup', async () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'carrier-access-test-secret-that-is-long-enough';
  try {
    const token = await createExtensionSession({
      id: 'extension-a', email: 'user@company.test', name: 'User', role: 'user',
      extension: '2000', organizationId: '', accountType: 'business',
    });
    await assert.rejects(
      () => requireSession({ headers: { authorization: `Bearer ${token}` } } as never),
      /Unauthorized/,
    );
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous;
  }
});

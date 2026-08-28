import assert from 'node:assert/strict';
import test from 'node:test';
import { createSession, createTenantAdminSession, requireOwner } from './auth.js';

test('platform carrier credentials reject a company extension session', async () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'carrier-access-test-secret-that-is-long-enough';
  try {
    const owner = await createSession('owner@vocivo.test');
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
    await requireOwner({ headers: { authorization: `Bearer ${owner}` } } as never);
    await assert.rejects(() => requireOwner({ headers: { authorization: `Bearer ${employee}` } } as never), /Forbidden/);
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous;
  }
});

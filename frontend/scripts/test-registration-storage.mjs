// Dedicated, disposable PostgreSQL only; never point this gate at production.
import assert from 'node:assert/strict';
import postgres from 'postgres';
const address = new URL(process.env.VOCIVO_TEST_DATABASE_URL || '');
assert.equal(address.hostname, '127.0.0.1');
assert.equal(address.pathname, '/vocivo_registration_test');
const admin = postgres(address.toString(), { max: 1 });
await admin`create role vocivo_registration_app login password 'local-test-only' nosuperuser nobypassrls`;
await admin`grant usage, create on schema public to vocivo_registration_app`;
const appAddress = new URL(address);
appAddress.username = 'vocivo_registration_app';
appAddress.password = 'local-test-only';
appAddress.searchParams.set('sslmode', 'disable');
process.env.DATABASE_URL = appAddress.toString();
process.env.DATABASE_POOL_MAX = '5';
const { initializeSaasRows, readTenantSaasRows, claimReplayKey } = await import('../api/_lib/shared/object-store.ts');
const { readTenantSaasState } = await import('../api/_lib/features/organizations/saas-store.ts');
try {
  await assert.rejects(readTenantSaasRows('a', { initialize: false }), { code: '42P01' });
  const tables = await admin`select tablename from pg_tables where schemaname='public'`;
  assert.equal(tables.length, 0, 'read-only auth must not initialize any table');
  const seed = {
    plans: [{ plan_id: 'test-plan', name: 'Test', description: '', monthly_price: 2.5, annual_price: 25,
      currency: 'USD', seat_limit: 10, phone_number_limit: 1, concurrent_call_limit: 5, storage_days: 30,
      features: { internalCalling: true }, active: true }],
    tenants: ['a', 'b'].map(organization_id => ({ organization_id, plan_id: 'test-plan', status: 'active',
      billing_cycle: 'monthly', amount: 2.5, currency: 'USD', starts_at: new Date(), trial_ends_at: null,
      renews_at: null, cancel_at_period_end: false, external_customer_id: '', notes: '', feature_overrides: {} })),
    admins: ['a', 'b'].map(organization_id => ({ id: `${organization_id}-admin`, organization_id,
      email: `${organization_id}@test.invalid`, name: 'Test', role: 'company_admin', password_hash: 'test-only',
      status: 'active', force_password_change: false, extension_id: `${organization_id}-extension`, extension: '2000',
      created_at: new Date(), updated_at: new Date() })),
  };
  await initializeSaasRows(seed);
  // Simultaneous tenant reads exercise pool reuse and forced RLS context.
  for (const row of await Promise.all(Array.from({length: 10}, async (_, index) => {
    const tenant = index % 2 ? 'a' : 'b';
    return { tenant, snapshot: await readTenantSaasRows(tenant, { initialize: false }) };
  }))) {
    assert.equal(row.snapshot.plans[0].monthly_price, 2.5);
    assert.deepEqual(row.snapshot.tenants.map(t => t.organization_id), [row.tenant]);
    assert.deepEqual(row.snapshot.admins.map(a => a.organization_id), [row.tenant]);
  }
  await assert.rejects(readTenantSaasState('missing', undefined, { initialize: false }), /subscription data is unavailable/);
  // Create the ledger through its normal maintenance path, then use the same
  // no-DDL path as REGISTER; disable probabilistic cleanup for deterministic tests.
  await claimReplayKey('test:ledger:initialize', new Date(Date.now()+60_000));
  const options = { initialize: false, cleanup: false };
  const key = 'test:concurrent:replay';
  const expiration = new Date(Date.now()+60_000);
  const claims = await Promise.all(Array.from({length: 20}, () => claimReplayKey(key, expiration, options)));
  assert.equal(claims.filter(Boolean).length, 1, 'exactly one concurrent Digest may win');
  await admin`update vocivo_replay_ledger set expires_at=now()-interval '1 second' where replay_key=${key}`;
  assert.equal(await claimReplayKey(key, expiration, options), true);
  assert.equal(await claimReplayKey(key, expiration, options), false);
  console.log('PASS: no auth DDL, tenant snapshot/RLS isolation, missing-data denial, concurrent replay and expired-key reclamation');
} finally {
  await admin.end();
}

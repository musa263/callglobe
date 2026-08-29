import { createHash, randomBytes } from 'node:crypto';
import postgres, { type Sql, type TransactionSql } from 'postgres';

export type PutOptions = {
  access?: 'public' | 'private';
  contentType?: string;
  allowOverwrite?: boolean;
  addRandomSuffix?: boolean;
  expectedEtag?: string | null;
};

export type PutEntry = { pathname: string; value: unknown; options?: PutOptions };

export type ObjectGroupMutation<T> = {
  puts?: PutEntry[];
  deletes?: string[];
  result: T;
};

type ListOptions = { prefix?: string; limit?: number; cursor?: string };
type StoredRow = { pathname: string; body: Buffer; content_type: string; access: string; uploaded_at: Date; etag: string };
let databaseClient: Sql | null = null;
let storageHealthCache: { expiresAt: number; value: { provider: 'postgres'; status: 'available' } } | null = null;
let storageHealthRequest: Promise<{ provider: 'postgres'; status: 'available' }> | null = null;
let replayTableReady = false;
let replayTableRequest: Promise<void> | null = null;
let saasTablesReady = false;
let saasTablesRequest: Promise<void> | null = null;

export type SaasPlanRow = {
  plan_id: string;
  name: string;
  description: string;
  monthly_price: number;
  annual_price: number;
  currency: string;
  seat_limit: number;
  phone_number_limit: number;
  concurrent_call_limit: number;
  storage_days: number;
  features: Record<string, boolean>;
  active: boolean;
};

export type SaasTenantRow = {
  organization_id: string;
  plan_id: string;
  status: string;
  billing_cycle: string;
  amount: number;
  currency: string;
  starts_at: Date | string;
  trial_ends_at: Date | string | null;
  renews_at: Date | string | null;
  cancel_at_period_end: boolean;
  external_customer_id: string;
  notes: string;
  feature_overrides: Record<string, boolean>;
};

export type SaasAdminRow = {
  id: string;
  organization_id: string;
  email: string;
  name: string;
  role: string;
  password_hash: string;
  status: string;
  force_password_change: boolean;
  extension_id: string | null;
  extension: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type SaasRows = { plans: SaasPlanRow[]; tenants: SaasTenantRow[]; admins: SaasAdminRow[] };

function databaseUrl() {
  const value = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!value) throw new Error('Missing server configuration: DATABASE_URL');
  return value;
}

function database() {
  if (databaseClient) return databaseClient;
  const url = new URL(databaseUrl());
  const requestedPoolSize = Number(process.env.DATABASE_POOL_MAX || 1);
  const poolSize = Number.isFinite(requestedPoolSize) ? Math.min(5, Math.max(1, Math.floor(requestedPoolSize))) : 1;
  databaseClient = postgres({
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: url.searchParams.get('sslmode') === 'disable' ? false : 'require',
    // The current Prisma database has a low direct-connection ceiling. Keep one
    // connection per serverless instance unless a pooled database is configured.
    max: poolSize,
    prepare: false,
    connect_timeout: 3,
    idle_timeout: 5,
    max_lifetime: 60,
  });
  return databaseClient;
}

export function transientDatabaseError(error: unknown) {
  const value = error as { code?: string; message?: string };
  return [
    '53300',
    '57P03',
    '08000',
    '08003',
    '08006',
    'CONNECT_TIMEOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENETUNREACH',
    'ETIMEDOUT',
  ].includes(value?.code || '')
    || /too many connections|connection (?:terminated|timed? out|refused)|connect_timeout/i.test(value?.message || '');
}

export async function withDatabaseRetry<T>(operation: (sql: Sql) => Promise<T>) {
  const delays = [0, 100, 350];
  let lastError: unknown;
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay + Math.floor(Math.random() * 180)));
    const sql = database();
    try {
      try {
        return await operation(sql);
      } catch (error) {
        if ((error as { code?: string })?.code !== '42P01') throw error;
        await ensureTable(sql);
        return await operation(sql);
      }
    } catch (error) {
      lastError = error;
      if (!transientDatabaseError(error)) throw error;
    }
  }
  throw lastError;
}

async function ensureTable(sql: Sql) {
  await sql`
    create table if not exists vocivo_objects (
      pathname text primary key,
      body bytea not null,
      content_type text not null default 'application/octet-stream',
      access text not null default 'private',
      uploaded_at timestamptz not null default now(),
      etag text not null
    )
  `;
}

async function ensureReplayTable(sql: Sql) {
  if (replayTableReady) return;
  replayTableRequest ||= sql`
    create table if not exists vocivo_replay_ledger (
      replay_key text primary key,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    )
  `.then(() => { replayTableReady = true; }).finally(() => { replayTableRequest = null; });
  await replayTableRequest;
}

async function ensureSaasTables(sql: Sql) {
  if (saasTablesReady) return;
  saasTablesRequest ||= (async () => {
    await sql`
      create table if not exists vocivo_saas_plans (
        plan_id text primary key,
        name text not null,
        description text not null default '',
        monthly_price numeric(12,2) not null,
        annual_price numeric(12,2) not null,
        currency varchar(3) not null,
        seat_limit integer not null,
        phone_number_limit integer not null,
        concurrent_call_limit integer not null,
        storage_days integer not null,
        features jsonb not null default '{}'::jsonb,
        active boolean not null default true,
        updated_at timestamptz not null default now()
      )
    `;
    await sql`
      create table if not exists vocivo_saas_tenants (
        organization_id text primary key,
        plan_id text not null,
        status text not null,
        billing_cycle text not null,
        amount numeric(12,2) not null,
        currency varchar(3) not null,
        starts_at timestamptz not null,
        trial_ends_at timestamptz,
        renews_at timestamptz,
        cancel_at_period_end boolean not null default false,
        external_customer_id text not null default '',
        notes text not null default '',
        version bigint not null default 1,
        updated_at timestamptz not null default now()
      )
    `;
    await sql`
      create table if not exists vocivo_saas_admins (
        id text primary key,
        organization_id text not null,
        email text not null,
        name text not null,
        role text not null,
        password_hash text not null,
        status text not null,
        force_password_change boolean not null default true,
        extension_id text,
        extension text,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        version bigint not null default 1
      )
    `;
    await sql`
      create table if not exists vocivo_saas_entitlements (
        organization_id text primary key,
        feature_overrides jsonb not null default '{}'::jsonb,
        version bigint not null default 1,
        updated_at timestamptz not null default now()
      )
    `;
    await sql`create unique index if not exists vocivo_saas_admins_email_uq on vocivo_saas_admins (lower(email))`;
    await sql`create index if not exists vocivo_saas_admins_tenant_idx on vocivo_saas_admins (organization_id)`;
    await sql`create index if not exists vocivo_saas_admins_extension_idx on vocivo_saas_admins (organization_id, extension_id)`;
    await sql`
      create table if not exists vocivo_schema_migrations (
        migration_id text primary key,
        applied_at timestamptz not null default now()
      )
    `;
    await sql.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtext('vocivo:schema:saas-rls-v1'))`;
      const applied = await transaction<Array<{ migration_id: string }>>`
        insert into vocivo_schema_migrations (migration_id)
        values ('saas-rls-v1')
        on conflict (migration_id) do nothing
        returning migration_id
      `;
      if (!applied.length) return;
      for (const table of ['vocivo_saas_tenants', 'vocivo_saas_admins', 'vocivo_saas_entitlements']) {
        await transaction.unsafe(`alter table ${table} enable row level security`);
        await transaction.unsafe(`alter table ${table} force row level security`);
        await transaction.unsafe(`
          create policy vocivo_tenant_isolation on ${table}
          using (
            current_setting('vocivo.platform_access', true) = 'on'
            or organization_id = nullif(current_setting('vocivo.organization_id', true), '')
          )
          with check (
            current_setting('vocivo.platform_access', true) = 'on'
            or organization_id = nullif(current_setting('vocivo.organization_id', true), '')
          )
        `);
      }
    });
    saasTablesReady = true;
  })().finally(() => { saasTablesRequest = null; });
  await saasTablesRequest;
}

async function setSaasTransactionContext(
  transaction: TransactionSql,
  organizationId?: string,
  platformAccess = false,
) {
  if (!platformAccess && !organizationId) throw new Error('Tenant transaction context is required.');
  await transaction`
    select
      set_config('vocivo.organization_id', ${organizationId || ''}, true),
      set_config('vocivo.platform_access', ${platformAccess ? 'on' : 'off'}, true)
  `;
}

export function assertTenantRowOwnership(expectedOrganizationId: string, actualOrganizationId: string) {
  if (!expectedOrganizationId || actualOrganizationId !== expectedOrganizationId) {
    throw new Error('Tenant row isolation violation.');
  }
}

function assertTenantRows<T extends { organization_id: string }>(organizationId: string, rows: T[]) {
  for (const row of rows) assertTenantRowOwnership(organizationId, row.organization_id);
  return rows;
}

async function selectSaasPlans(sql: Sql | TransactionSql) {
  return sql<SaasPlanRow[]>`
    select plan_id, name, description, monthly_price::float8 as monthly_price,
      annual_price::float8 as annual_price, currency, seat_limit, phone_number_limit,
      concurrent_call_limit, storage_days, features, active
    from vocivo_saas_plans order by monthly_price asc, plan_id asc
  `;
}

async function insertPlan(transaction: Sql | TransactionSql, row: SaasPlanRow) {
  await transaction`
    insert into vocivo_saas_plans (
      plan_id, name, description, monthly_price, annual_price, currency, seat_limit,
      phone_number_limit, concurrent_call_limit, storage_days, features, active, updated_at
    ) values (
      ${row.plan_id}, ${row.name}, ${row.description}, ${row.monthly_price}, ${row.annual_price},
      ${row.currency}, ${row.seat_limit}, ${row.phone_number_limit}, ${row.concurrent_call_limit},
      ${row.storage_days}, ${transaction.json(row.features)}, ${row.active}, now()
    )
    on conflict (plan_id) do update set name = excluded.name, description = excluded.description,
      monthly_price = excluded.monthly_price, annual_price = excluded.annual_price,
      currency = excluded.currency, seat_limit = excluded.seat_limit,
      phone_number_limit = excluded.phone_number_limit,
      concurrent_call_limit = excluded.concurrent_call_limit, storage_days = excluded.storage_days,
      features = excluded.features, active = excluded.active, updated_at = now()
  `;
}

async function insertTenant(transaction: Sql | TransactionSql, row: SaasTenantRow) {
  if (!row.organization_id) throw new Error('Tenant organization is required.');
  await transaction`
    insert into vocivo_saas_tenants (
      organization_id, plan_id, status, billing_cycle, amount, currency, starts_at,
      trial_ends_at, renews_at, cancel_at_period_end, external_customer_id, notes,
      version, updated_at
    ) values (
      ${row.organization_id}, ${row.plan_id}, ${row.status}, ${row.billing_cycle}, ${row.amount},
      ${row.currency}, ${row.starts_at}, ${row.trial_ends_at}, ${row.renews_at},
      ${row.cancel_at_period_end}, ${row.external_customer_id}, ${row.notes},
      1, now()
    )
    on conflict (organization_id) do update set plan_id = excluded.plan_id,
      status = excluded.status, billing_cycle = excluded.billing_cycle, amount = excluded.amount,
      currency = excluded.currency, starts_at = excluded.starts_at,
      trial_ends_at = excluded.trial_ends_at, renews_at = excluded.renews_at,
      cancel_at_period_end = excluded.cancel_at_period_end,
      external_customer_id = excluded.external_customer_id, notes = excluded.notes,
      version = vocivo_saas_tenants.version + 1, updated_at = now()
  `;
}

async function insertEntitlements(transaction: Sql | TransactionSql, organizationId: string, overrides: Record<string, boolean>) {
  if (!organizationId) throw new Error('Tenant organization is required.');
  await transaction`
    insert into vocivo_saas_entitlements (organization_id, feature_overrides, version, updated_at)
    values (${organizationId}, ${transaction.json(overrides)}, 1, now())
    on conflict (organization_id) do update set feature_overrides = excluded.feature_overrides,
      version = vocivo_saas_entitlements.version + 1, updated_at = now()
  `;
}

async function insertAdmin(transaction: Sql | TransactionSql, row: SaasAdminRow) {
  if (!row.organization_id) throw new Error('Administrator organization is required.');
  await transaction`
    insert into vocivo_saas_admins (
      id, organization_id, email, name, role, password_hash, status,
      force_password_change, extension_id, extension, created_at, updated_at, version
    ) values (
      ${row.id}, ${row.organization_id}, ${row.email}, ${row.name}, ${row.role},
      ${row.password_hash}, ${row.status}, ${row.force_password_change},
      ${row.extension_id}, ${row.extension}, ${row.created_at}, ${row.updated_at}, 1
    )
    on conflict (id) do update set organization_id = excluded.organization_id,
      email = excluded.email, name = excluded.name, role = excluded.role,
      password_hash = excluded.password_hash, status = excluded.status,
      force_password_change = excluded.force_password_change,
      extension_id = excluded.extension_id, extension = excluded.extension,
      updated_at = excluded.updated_at, version = vocivo_saas_admins.version + 1
  `;
}

export async function initializeSaasRows(seed: SaasRows) {
  return withDatabaseRetry(async (sql) => {
    await ensureSaasTables(sql);
    return sql.begin(async (transaction) => {
      await setSaasTransactionContext(transaction, undefined, true);
      await transaction`select pg_advisory_xact_lock(hashtext('vocivo:saas:bootstrap:v2'))`;
      const planIds = await transaction<Array<{ plan_id: string }>>`select plan_id from vocivo_saas_plans`;
      const tenantIds = await transaction<Array<{ organization_id: string }>>`select organization_id from vocivo_saas_tenants`;
      const adminIds = await transaction<Array<{ id: string }>>`select id from vocivo_saas_admins`;
      const entitlementIds = await transaction<Array<{ organization_id: string }>>`select organization_id from vocivo_saas_entitlements`;
      const existingPlans = new Set(planIds.map((row) => row.plan_id));
      const existingTenants = new Set(tenantIds.map((row) => row.organization_id));
      const existingAdmins = new Set(adminIds.map((row) => row.id));
      const existingEntitlements = new Set(entitlementIds.map((row) => row.organization_id));
      for (const row of seed.plans) if (!existingPlans.has(row.plan_id)) await insertPlan(transaction, row);
      for (const row of seed.tenants) {
        if (!existingTenants.has(row.organization_id)) await insertTenant(transaction, row);
        if (!existingEntitlements.has(row.organization_id)) await insertEntitlements(transaction, row.organization_id, row.feature_overrides);
      }
      for (const row of seed.admins) if (!existingAdmins.has(row.id)) await insertAdmin(transaction, row);
      return true;
    });
  });
}

export async function readPlatformSaasRows(): Promise<SaasRows> {
  return withDatabaseRetry(async (sql) => {
    await ensureSaasTables(sql);
    return sql.begin(async (transaction) => {
      await setSaasTransactionContext(transaction, undefined, true);
      const plans = await selectSaasPlans(transaction);
      const tenants = await transaction<SaasTenantRow[]>`
        select t.organization_id, plan_id, status, billing_cycle, amount::float8 as amount,
          currency, starts_at, trial_ends_at, renews_at, cancel_at_period_end,
          external_customer_id, notes, coalesce(e.feature_overrides, '{}'::jsonb) as feature_overrides
        from vocivo_saas_tenants t
        left join vocivo_saas_entitlements e using (organization_id)
        order by t.organization_id asc
      `;
      const admins = await transaction<SaasAdminRow[]>`
        select id, organization_id, email, name, role, password_hash, status,
          force_password_change, extension_id, extension, created_at, updated_at
        from vocivo_saas_admins order by organization_id asc, created_at asc
      `;
      return { plans, tenants, admins };
    });
  });
}

export async function readTenantSaasRows(organizationId: string): Promise<SaasRows> {
  if (!organizationId) throw new Error('Tenant organization is required.');
  return withDatabaseRetry(async (sql) => {
    await ensureSaasTables(sql);
    return sql.begin(async (transaction) => {
      await setSaasTransactionContext(transaction, organizationId);
      const plans = await selectSaasPlans(transaction);
      const tenants = await transaction<SaasTenantRow[]>`
        select t.organization_id, plan_id, status, billing_cycle, amount::float8 as amount,
          currency, starts_at, trial_ends_at, renews_at, cancel_at_period_end,
          external_customer_id, notes, coalesce(e.feature_overrides, '{}'::jsonb) as feature_overrides
        from vocivo_saas_tenants t
        left join vocivo_saas_entitlements e using (organization_id)
        where t.organization_id = ${organizationId}
      `;
      const admins = await transaction<SaasAdminRow[]>`
        select id, organization_id, email, name, role, password_hash, status,
          force_password_change, extension_id, extension, created_at, updated_at
        from vocivo_saas_admins where organization_id = ${organizationId} order by created_at asc
      `;
      return { plans, tenants: assertTenantRows(organizationId, tenants), admins: assertTenantRows(organizationId, admins) };
    });
  });
}

export async function findSaasAdminByEmailForAuthentication(email: string) {
  return withDatabaseRetry(async (sql) => {
    await ensureSaasTables(sql);
    return sql.begin(async (transaction) => {
      await setSaasTransactionContext(transaction, undefined, true);
      const rows = await transaction<SaasAdminRow[]>`
        select id, organization_id, email, name, role, password_hash, status,
          force_password_change, extension_id, extension, created_at, updated_at
        from vocivo_saas_admins where lower(email) = ${email.trim().toLowerCase()} limit 1
      `;
      if (rows[0] && !rows[0].organization_id) throw new Error('Tenant row isolation violation.');
      return rows[0] || null;
    });
  });
}

export async function upsertSaasPlan(row: SaasPlanRow) {
  await withDatabaseRetry(async (sql) => {
    await ensureSaasTables(sql);
    await sql.begin(async (transaction) => {
      await setSaasTransactionContext(transaction, undefined, true);
      await transaction`select pg_advisory_xact_lock(hashtext(${`vocivo:saas:plan:${row.plan_id}`}))`;
      await insertPlan(transaction, row);
    });
  });
}

export async function upsertTenantSaasRow(organizationId: string, row: SaasTenantRow) {
  assertTenantRowOwnership(organizationId, row.organization_id);
  await withDatabaseRetry(async (sql) => {
    await ensureSaasTables(sql);
    await sql.begin(async (transaction) => {
      await setSaasTransactionContext(transaction, organizationId);
      await transaction`select pg_advisory_xact_lock(hashtext(${`vocivo:saas:tenant:${organizationId}`}))`;
      await insertTenant(transaction, row);
    });
  });
}

export async function upsertTenantSaasOverrides(organizationId: string, overrides: Record<string, boolean>) {
  if (!organizationId) throw new Error('Tenant organization is required.');
  await withDatabaseRetry(async (sql) => {
    await ensureSaasTables(sql);
    await sql.begin(async (transaction) => {
      await setSaasTransactionContext(transaction, organizationId);
      await transaction`select pg_advisory_xact_lock(hashtext(${`vocivo:saas:tenant:${organizationId}`}))`;
      await insertEntitlements(transaction, organizationId, overrides);
    });
  });
}

export async function upsertTenantSaasAdmin(organizationId: string, row: SaasAdminRow) {
  assertTenantRowOwnership(organizationId, row.organization_id);
  await withDatabaseRetry(async (sql) => {
    await ensureSaasTables(sql);
    await sql.begin(async (transaction) => {
      await setSaasTransactionContext(transaction, organizationId);
      await transaction`select pg_advisory_xact_lock(hashtext(${`vocivo:saas:tenant:${organizationId}`}))`;
      const existing = await transaction<Array<{ organization_id: string }>>`
        select organization_id from vocivo_saas_admins where id = ${row.id} for update
      `;
      if (existing[0]) assertTenantRowOwnership(organizationId, existing[0].organization_id);
      await insertAdmin(transaction, row);
    });
  });
}

export async function deleteTenantSaasAdmin(organizationId: string, id: string) {
  if (!id) return false;
  return withDatabaseRetry(async (sql) => {
    await ensureSaasTables(sql);
    return sql.begin(async (transaction) => {
      await setSaasTransactionContext(transaction, organizationId);
      await transaction`select pg_advisory_xact_lock(hashtext(${`vocivo:saas:tenant:${organizationId}`}))`;
      const rows = await transaction<Array<{ id: string }>>`
        delete from vocivo_saas_admins where id = ${id} and organization_id = ${organizationId} returning id
      `;
      return rows.length === 1;
    });
  });
}

export async function deleteTenantSaasAdminsForExtension(organizationId: string, extensionId: string) {
  return withDatabaseRetry(async (sql) => {
    await ensureSaasTables(sql);
    return sql.begin(async (transaction) => {
      await setSaasTransactionContext(transaction, organizationId);
      await transaction`select pg_advisory_xact_lock(hashtext(${`vocivo:saas:tenant:${organizationId}`}))`;
      const rows = await transaction<Array<{ id: string }>>`
        delete from vocivo_saas_admins
        where organization_id = ${organizationId} and extension_id = ${extensionId}
        returning id
      `;
      return rows.length;
    });
  });
}

export async function deleteAllTenantSaasAdmins(organizationId: string) {
  await withDatabaseRetry(async (sql) => {
    await ensureSaasTables(sql);
    await sql.begin(async (transaction) => {
      await setSaasTransactionContext(transaction, organizationId);
      await transaction`select pg_advisory_xact_lock(hashtext(${`vocivo:saas:tenant:${organizationId}`}))`;
      await transaction`delete from vocivo_saas_admins where organization_id = ${organizationId}`;
    });
  });
}

async function bodyBuffer(value: unknown) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (value instanceof Blob) return Buffer.from(await value.arrayBuffer());
  throw new Error('Unsupported stored object body.');
}

function suffixedPath(pathname: string) {
  const suffix = randomBytes(8).toString('hex');
  const dot = pathname.lastIndexOf('.');
  return dot > pathname.lastIndexOf('/') ? `${pathname.slice(0, dot)}-${suffix}${pathname.slice(dot)}` : `${pathname}-${suffix}`;
}

function publicUrl(pathname: string) {
  const base = (process.env.VITE_APP_URL || 'https://vocivo.vercel.app').replace(/\/+$/, '');
  return `${base}/api/storage?path=${encodeURIComponent(pathname)}`;
}

function blobMetadata(row: Pick<StoredRow, 'pathname' | 'content_type' | 'uploaded_at' | 'etag'> & { size?: number }) {
  const url = publicUrl(row.pathname);
  return {
    url,
    downloadUrl: `${url}&download=1`,
    pathname: row.pathname,
    contentType: row.content_type,
    contentDisposition: 'inline',
    size: Number(row.size || 0),
    uploadedAt: new Date(row.uploaded_at),
    etag: row.etag,
  };
}

export async function put(pathname: string, value: unknown, options: PutOptions = {}) {
  const body = await bodyBuffer(value);
  const storedPath = options.addRandomSuffix ? suffixedPath(pathname) : pathname;
  const contentType = options.contentType || 'application/octet-stream';
  const access = options.access || 'private';
  const etag = createHash('sha256').update(body).digest('hex');
  return withDatabaseRetry(async (sql) => {
    const rows = options.allowOverwrite
      ? await sql<StoredRow[]>`
          insert into vocivo_objects (pathname, body, content_type, access, uploaded_at, etag)
          values (${storedPath}, ${body}, ${contentType}, ${access}, now(), ${etag})
          on conflict (pathname) do update set body = excluded.body, content_type = excluded.content_type,
            access = excluded.access, uploaded_at = excluded.uploaded_at, etag = excluded.etag
          returning pathname, content_type, access, uploaded_at, etag
        `
      : await sql<StoredRow[]>`
          insert into vocivo_objects (pathname, body, content_type, access, uploaded_at, etag)
          values (${storedPath}, ${body}, ${contentType}, ${access}, now(), ${etag})
          on conflict (pathname) do nothing
          returning pathname, content_type, access, uploaded_at, etag
        `;
    const row = rows[0];
    if (!row) throw new Error('Stored object already exists.');
    return blobMetadata({ ...row, size: body.length });
  });
}

export async function putMany(entries: PutEntry[]) {
  const prepared = await Promise.all(entries.map(async ({ pathname, value, options = {} }) => {
    const body = await bodyBuffer(value);
    return {
      body,
      storedPath: options.addRandomSuffix ? suffixedPath(pathname) : pathname,
      contentType: options.contentType || 'application/octet-stream',
      access: options.access || 'private',
      etag: createHash('sha256').update(body).digest('hex'),
      allowOverwrite: options.allowOverwrite === true,
      expectedEtag: options.expectedEtag,
    };
  }));
  return withDatabaseRetry(async (sql) => {
    return sql.begin(async (transaction) => {
      const results = [];
      const lockPaths = [...new Set(prepared.map((item) => item.storedPath))].sort();
      for (const lockPath of lockPaths) await transaction`select pg_advisory_xact_lock(hashtext(${lockPath}))`;
      for (const item of prepared) {
        const rows = item.expectedEtag === null
          ? await transaction<StoredRow[]>`
              insert into vocivo_objects (pathname, body, content_type, access, uploaded_at, etag)
              values (${item.storedPath}, ${item.body}, ${item.contentType}, ${item.access}, now(), ${item.etag})
              on conflict (pathname) do nothing
              returning pathname, content_type, access, uploaded_at, etag
            `
          : typeof item.expectedEtag === 'string'
            ? await transaction<StoredRow[]>`
                update vocivo_objects set body = ${item.body}, content_type = ${item.contentType},
                  access = ${item.access}, uploaded_at = now(), etag = ${item.etag}
                where pathname = ${item.storedPath} and etag = ${item.expectedEtag}
                returning pathname, content_type, access, uploaded_at, etag
              `
            : item.allowOverwrite
              ? await transaction<StoredRow[]>`
            insert into vocivo_objects (pathname, body, content_type, access, uploaded_at, etag)
            values (${item.storedPath}, ${item.body}, ${item.contentType}, ${item.access}, now(), ${item.etag})
            on conflict (pathname) do update set body = excluded.body, content_type = excluded.content_type,
              access = excluded.access, uploaded_at = excluded.uploaded_at, etag = excluded.etag
            returning pathname, content_type, access, uploaded_at, etag
          `
              : await transaction<StoredRow[]>`
            insert into vocivo_objects (pathname, body, content_type, access, uploaded_at, etag)
            values (${item.storedPath}, ${item.body}, ${item.contentType}, ${item.access}, now(), ${item.etag})
            on conflict (pathname) do nothing
            returning pathname, content_type, access, uploaded_at, etag
          `;
        const row = rows[0];
        if (!row) throw new Error(item.expectedEtag === undefined ? 'Stored object already exists.' : 'Stored object compare-and-swap failed.');
        results.push(blobMetadata({ ...row, size: item.body.length }));
      }
      return results;
    });
  });
}

export async function readObject(pathname: string) {
  return withDatabaseRetry(async (sql) => {
    const rows = await sql<Array<{ body: Buffer }>>`select body from vocivo_objects where pathname = ${pathname} limit 1`;
    return rows[0]?.body ? Buffer.from(rows[0].body) : null;
  });
}

export async function readObjects(pathnames: string[]) {
  if (!pathnames.length) return new Map<string, Buffer>();
  return withDatabaseRetry(async (sql) => {
    const rows = await sql<Array<{ pathname: string; body: Buffer }>>`
      select pathname, body from vocivo_objects where pathname in ${sql(pathnames)}
    `;
    return new Map(rows.map((row) => [row.pathname, Buffer.from(row.body)]));
  });
}

export async function updateObject(pathname: string, update: (current: Buffer) => Buffer | Promise<Buffer>) {
  return withDatabaseRetry(async (sql) => {
    return sql.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtext(${pathname}))`;
      const currentRows = await transaction<Array<{ body: Buffer; etag: string }>>`
        select body, etag from vocivo_objects where pathname = ${pathname} for update
      `;
      const current = currentRows[0];
      if (!current) return null;
      const body = await update(Buffer.from(current.body));
      const etag = createHash('sha256').update(body).digest('hex');
      const rows = await transaction<StoredRow[]>`
        update vocivo_objects
        set body = ${body}, uploaded_at = now(), etag = ${etag}
        where pathname = ${pathname} and etag = ${current.etag}
        returning pathname, content_type, access, uploaded_at, etag
      `;
      if (!rows[0]) throw new Error('Stored object changed during the transaction.');
      return body;
    });
  });
}

export async function transactObjectGroup<T>(
  lockKey: string,
  readPathnames: string[],
  update: (current: Map<string, { body: Buffer; etag: string }>) => ObjectGroupMutation<T> | Promise<ObjectGroupMutation<T>>,
) {
  if (!lockKey) throw new Error('Object transaction lock key is required.');
  return withDatabaseRetry(async (sql) => {
    return sql.begin(async (transaction) => {
      const paths = [...new Set(readPathnames.filter(Boolean))].sort();
      const lockKeys = [...new Set([lockKey, ...paths])].sort();
      for (const key of lockKeys) await transaction`select pg_advisory_xact_lock(hashtext(${key}))`;
      const rows: Array<{ pathname: string; body: Buffer; etag: string }> = paths.length
        ? await transaction<Array<{ pathname: string; body: Buffer; etag: string }>>`
            select pathname, body, etag from vocivo_objects where pathname in ${transaction(paths)} for update
          `
        : [];
      const current = new Map<string, { body: Buffer; etag: string }>(rows.map((row) => [
        row.pathname,
        { body: Buffer.from(row.body), etag: row.etag },
      ]));
      const mutation = await update(current);
      const prepared = await Promise.all((mutation.puts || []).map(async ({ pathname, value, options = {} }) => {
        const body = await bodyBuffer(value);
        return {
          pathname,
          body,
          contentType: options.contentType || 'application/octet-stream',
          access: options.access || 'private',
          etag: createHash('sha256').update(body).digest('hex'),
        };
      }));
      for (const item of prepared) {
        await transaction`
          insert into vocivo_objects (pathname, body, content_type, access, uploaded_at, etag)
          values (${item.pathname}, ${item.body}, ${item.contentType}, ${item.access}, now(), ${item.etag})
          on conflict (pathname) do update set body = excluded.body, content_type = excluded.content_type,
            access = excluded.access, uploaded_at = excluded.uploaded_at, etag = excluded.etag
        `;
      }
      const deletes = [...new Set((mutation.deletes || []).filter((pathname) => !prepared.some((item) => item.pathname === pathname)))];
      if (deletes.length) await transaction`delete from vocivo_objects where pathname in ${transaction(deletes)}`;
      return mutation.result;
    });
  });
}

export async function transactObject(
  pathname: string,
  update: (current: Buffer | null) => Buffer | Promise<Buffer>,
  options: Pick<PutOptions, 'access' | 'contentType'> = {},
) {
  const contentType = options.contentType || 'application/octet-stream';
  const access = options.access || 'private';
  return withDatabaseRetry(async (sql) => {
    return sql.begin(async (transaction) => {
      // The advisory lock also serializes first-write races where no row exists
      // yet. The etag predicate is the compare-and-swap guard for existing rows.
      await transaction`select pg_advisory_xact_lock(hashtext(${pathname}))`;
      const currentRows = await transaction<Array<{ body: Buffer; etag: string }>>`
        select body, etag from vocivo_objects where pathname = ${pathname} for update
      `;
      const current = currentRows[0];
      const body = await update(current?.body ? Buffer.from(current.body) : null);
      const etag = createHash('sha256').update(body).digest('hex');
      const rows = current
        ? await transaction<StoredRow[]>`
            update vocivo_objects
            set body = ${body}, content_type = ${contentType}, access = ${access}, uploaded_at = now(), etag = ${etag}
            where pathname = ${pathname} and etag = ${current.etag}
            returning pathname, content_type, access, uploaded_at, etag
          `
        : await transaction<StoredRow[]>`
            insert into vocivo_objects (pathname, body, content_type, access, uploaded_at, etag)
            values (${pathname}, ${body}, ${contentType}, ${access}, now(), ${etag})
            on conflict (pathname) do nothing
            returning pathname, content_type, access, uploaded_at, etag
          `;
      if (!rows[0]) throw new Error('Stored object changed during the transaction.');
      return { body, blob: blobMetadata({ ...rows[0], size: body.length }) };
    });
  });
}

export async function get(pathname: string, _options: { access?: 'public' | 'private'; useCache?: boolean } = {}) {
  return withDatabaseRetry(async (sql) => {
    const rows = await sql<StoredRow[]>`
      select pathname, body, content_type, access, uploaded_at, etag
      from vocivo_objects where pathname = ${pathname} limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    const body = Buffer.from(row.body);
    return { statusCode: 200, stream: new Response(new Uint8Array(body)).body, blob: blobMetadata({ ...row, size: body.length }) };
  });
}

export async function list(options: ListOptions = {}) {
  const prefix = options.prefix || '';
  const limit = Math.min(Math.max(Number(options.limit) || 1000, 1), 1000);
  const offset = options.cursor ? Math.max(0, Number(Buffer.from(options.cursor, 'base64url').toString('utf8')) || 0) : 0;
  return withDatabaseRetry(async (sql) => {
    const rows = await sql<Array<StoredRow & { size: number }>>`
      select pathname, content_type, access, uploaded_at, etag, octet_length(body)::int as size
      from vocivo_objects
      where pathname >= ${prefix} and pathname < ${`${prefix}\uffff`}
      order by pathname asc
      limit ${limit + 1} offset ${offset}
    `;
    const hasMore = rows.length > limit;
    return {
      blobs: rows.slice(0, limit).map(blobMetadata),
      hasMore,
      cursor: hasMore ? Buffer.from(String(offset + limit)).toString('base64url') : undefined,
    };
  });
}

export async function del(pathnames: string | string[]) {
  const values = Array.isArray(pathnames) ? pathnames : [pathnames];
  if (!values.length) return;
  await withDatabaseRetry(async (sql) => {
    await sql`delete from vocivo_objects where pathname in ${sql(values)}`;
  });
}

export async function claimReplayKey(replayKey: string, expiresAt: Date) {
  if (!/^[a-z0-9:_-]{16,200}$/i.test(replayKey)) throw new Error('Invalid replay key.');
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) throw new Error('Invalid replay expiration.');
  return withDatabaseRetry(async (sql) => {
    await ensureReplayTable(sql);
    await sql`delete from vocivo_replay_ledger where replay_key = ${replayKey} and expires_at <= now()`;
    const rows = await sql<Array<{ replay_key: string }>>`
      insert into vocivo_replay_ledger (replay_key, expires_at)
      values (${replayKey}, ${expiresAt})
      on conflict (replay_key) do nothing
      returning replay_key
    `;
    if (Math.random() < 0.02) await sql`delete from vocivo_replay_ledger where expires_at <= now()`;
    return rows.length === 1;
  });
}

export async function releaseReplayKey(replayKey: string) {
  if (!/^[a-z0-9:_-]{16,200}$/i.test(replayKey)) throw new Error('Invalid replay key.');
  return withDatabaseRetry(async (sql) => {
    await ensureReplayTable(sql);
    const rows = await sql<Array<{ replay_key: string }>>`
      delete from vocivo_replay_ledger
      where replay_key = ${replayKey}
      returning replay_key
    `;
    return rows.length === 1;
  });
}

export async function storageHealth() {
  if (storageHealthCache && storageHealthCache.expiresAt > Date.now()) return storageHealthCache.value;
  if (storageHealthRequest) return storageHealthRequest;
  storageHealthRequest = withDatabaseRetry(async (sql) => {
    await sql`select 1`;
    return { provider: 'postgres' as const, status: 'available' as const };
  }).then((value) => {
    storageHealthCache = { expiresAt: Date.now() + 5_000, value };
    return value;
  }).finally(() => {
    storageHealthRequest = null;
  });
  return storageHealthRequest;
}

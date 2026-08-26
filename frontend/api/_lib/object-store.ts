import { createHash, randomBytes } from 'node:crypto';
import postgres, { type Sql } from 'postgres';

export type PutOptions = {
  access?: 'public' | 'private';
  contentType?: string;
  allowOverwrite?: boolean;
  addRandomSuffix?: boolean;
};

export type PutEntry = { pathname: string; value: unknown; options?: PutOptions };

type ListOptions = { prefix?: string; limit?: number; cursor?: string };
type StoredRow = { pathname: string; body: Buffer; content_type: string; access: string; uploaded_at: Date; etag: string };
let databaseClient: Sql | null = null;

function databaseUrl() {
  const value = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!value) throw new Error('Missing server configuration: DATABASE_URL');
  return value;
}

function database() {
  if (databaseClient) return databaseClient;
  const url = new URL(databaseUrl());
  databaseClient = postgres({
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: url.searchParams.get('sslmode') === 'disable' ? false : 'require',
    max: 4,
    prepare: false,
    connect_timeout: 3,
    idle_timeout: 5,
    max_lifetime: 60,
  });
  return databaseClient;
}

function transientDatabaseError(error: unknown) {
  const value = error as { code?: string; message?: string };
  return ['53300', '57P03', '08000', '08003', '08006', 'ECONNRESET', 'ETIMEDOUT'].includes(value?.code || '')
    || /too many connections|connection terminated|connection timeout|connection refused/i.test(value?.message || '');
}

async function withDatabaseRetry<T>(operation: (sql: Sql) => Promise<T>) {
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
    };
  }));
  return withDatabaseRetry(async (sql) => {
    const results = [];
    for (const item of prepared) {
      const rows = item.allowOverwrite
        ? await sql<StoredRow[]>`
            insert into vocivo_objects (pathname, body, content_type, access, uploaded_at, etag)
            values (${item.storedPath}, ${item.body}, ${item.contentType}, ${item.access}, now(), ${item.etag})
            on conflict (pathname) do update set body = excluded.body, content_type = excluded.content_type,
              access = excluded.access, uploaded_at = excluded.uploaded_at, etag = excluded.etag
            returning pathname, content_type, access, uploaded_at, etag
          `
        : await sql<StoredRow[]>`
            insert into vocivo_objects (pathname, body, content_type, access, uploaded_at, etag)
            values (${item.storedPath}, ${item.body}, ${item.contentType}, ${item.access}, now(), ${item.etag})
            on conflict (pathname) do nothing
            returning pathname, content_type, access, uploaded_at, etag
          `;
      const row = rows[0];
      if (!row) throw new Error('Stored object already exists.');
      results.push(blobMetadata({ ...row, size: item.body.length }));
    }
    return results;
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
    const rows = await sql<Array<{ body: Buffer }>>`select body from vocivo_objects where pathname = ${pathname} limit 1`;
    if (!rows[0]?.body) return null;
    const body = await update(Buffer.from(rows[0].body));
    const etag = createHash('sha256').update(body).digest('hex');
    await sql`update vocivo_objects set body = ${body}, uploaded_at = now(), etag = ${etag} where pathname = ${pathname}`;
    return body;
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

export async function storageHealth() {
  return withDatabaseRetry(async (sql) => {
    const rows = await sql<Array<{ count: number }>>`select count(*)::int as count from vocivo_objects`;
    return { provider: 'postgres', objects: Number(rows[0]?.count || 0) };
  });
}

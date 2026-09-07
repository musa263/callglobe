import assert from 'node:assert/strict';
import test from 'node:test';
import { createCipheriv, createHash } from 'node:crypto';
import type { transactObject } from '../../shared/object-store.js';
import type { ExtensionUser } from './pbx.js';
import { defaultPbxConfig } from './pbx-config-store.js';
import { adoptExtensionDirectory, readExtensionDirectoryState, updateExtensionDirectory } from './extension-store.js';
import { adoptVocivoExtensions, decodeExtensionDirectory } from './extension-directory.js';
import { assertVocivoExtensionEngine, createVocivoExtensionService } from './vocivo-extensions.js';
import { createCurrentExtensionReader } from './extension-identity.js';
import { createSipCredentialsHandler } from '../sip/routes/voice-sip-credentials.js';
import { digestHa1 } from '../sip/sip-digest.js';
import type { StoredSipCredential } from '../sip/sip-credential-store.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const employee: ExtensionUser = { id: 'legacy-employee', organizationId: 'tenant-a', extension: '2000',
  name: 'Employee', email: 'employee@example.test', mobile: '', department: 'Sales', role: 'user',
  status: 'active', sipUsername: 'legacy_sip_username', sipProvider: 'telnyx', createdAt: '2025-01-01T00:00:00Z' };

function encrypted(value: unknown) {
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(`${process.env.AUTH_SECRET}:extension-store:v1`).digest(), iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
}

function memory(initial: Buffer | null) {
  let bytes = initial;
  let commits = 0;
  let tail = Promise.resolve();
  const transaction = (async (_path, mutate) => {
    const previous = tail;
    let unlock!: () => void;
    tail = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    try {
      const next = await mutate(bytes);
      assert.ok(next);
      bytes = next;
      commits++;
      return { body: bytes };
    } finally { unlock(); }
  }) as typeof transactObject;
  return { transaction, read: async () => bytes, commits: () => commits, bytes: () => bytes };
}

async function fixture() {
  const db = memory(encrypted({ version: 2, revision: 10, syncedAt: 'before', extensions: [employee] }));
  await adoptExtensionDirectory({}, db.transaction);
  const config = defaultPbxConfig();
  config.organizations = ['tenant-a', 'tenant-b'].map((id) => ({ id, name: id, slug: id,
    extensionStart: 2000, extensionEnd: 2002, accountType: 'business', ownerDisplayName: '', ownerEmail: '',
    internalCallingEnabled: true, status: 'active' }));
  let serial = 0;
  const revoked: string[] = [];
  let beforeUpdate = async () => {};
  let revokeError = false;
  const service = createVocivoExtensionService({
    readDirectory: () => readExtensionDirectoryState(db.read), readConfig: async () => config,
    updateDirectory: async (update) => { await beforeUpdate(); return updateExtensionDirectory(update, db.transaction, 'vocivo'); },
    revoke: async (id) => { if (revokeError) throw new Error('revocation unavailable'); revoked.push(id); },
    newId: () => `fixture-${++serial}`,
  });
  return { db, service, config, revoked, race: (fn: () => Promise<void>) => { beforeUpdate = async () => { beforeUpdate = async () => {}; await fn(); }; }, failRevocation: () => { revokeError = true; } };
}

test('Vocivo directory migration and lifecycle', async (t) => {
  const oldSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'vocivo-directory-test-only';
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('No network calls are allowed in extension lifecycle tests'); };
  try {
    await t.test('adoption preserves every identity field and is idempotent', async () => {
      const db = memory(encrypted({ version: 1, syncedAt: 'before', extensions: [employee] }));
      const migrated = await adoptExtensionDirectory({}, db.transaction);
      assert.deepEqual(migrated.extensions, [{ ...employee, sipProvider: 'vocivo' }]);
      const once = db.bytes();
      await adoptExtensionDirectory({}, db.transaction);
      assert.deepEqual(db.bytes(), once);
      assert.equal((await readExtensionDirectoryState(db.read))?.authority, 'vocivo');
      await assert.rejects(updateExtensionDirectory(() => [], db.transaction, 'telnyx'), /authority changed/);
      assert.deepEqual(db.bytes(), once);
    });
    await t.test('missing and corrupt directories fail closed, with explicit empty initialization', async () => {
      const db = memory(null);
      await assert.rejects(adoptExtensionDirectory({}, db.transaction), /missing/);
      assert.equal(db.commits(), 0);
      const fresh = await adoptExtensionDirectory({ initializeEmpty: true }, db.transaction);
      assert.deepEqual(fresh.extensions, []);
      for (const bytes of [Buffer.from('corrupt'), encrypted({ version: 99, extensions: [] })]) {
        const broken = memory(bytes);
        await assert.rejects(readExtensionDirectoryState(broken.read));
        await assert.rejects(adoptExtensionDirectory({}, broken.transaction));
        assert.equal(broken.commits(), 0);
        assert.deepEqual(broken.bytes(), bytes);
      }
    });
    await t.test('migration refuses a changed revision', async () => {
      const db = memory(encrypted({ version: 2, revision: 2, extensions: [employee] }));
      await assert.rejects(adoptExtensionDirectory({ expectedRevision: 1 }, db.transaction), /changed during/);
      assert.equal(db.commits(), 0);
    });
    await t.test('duplicate identities and malformed legacy data cannot be adopted', () => {
      for (const duplicate of [employee, { ...employee, id: 'other' }, { ...employee, id: 'other', sipUsername: 'other' }]) {
        assert.throws(() => adoptVocivoExtensions([employee, duplicate]), /duplicate/);
      }
      for (const patch of [{ organizationId: '' }, { sipUsername: 'bad@host' }, { status: 'unknown' }, { role: 'owner' }]) {
        assert.throws(() => adoptVocivoExtensions([{ ...employee, ...patch } as ExtensionUser]), /invalid/);
      }
      assert.throws(() => decodeExtensionDirectory({ version: 3, authority: 'telnyx', extensions: [] }), /invalid/);
      assert.throws(() => decodeExtensionDirectory({ version: 3, authority: 'vocivo', revision: -1, extensions: [] }), /invalid/);
    });
    await t.test('concurrent automatic allocation is unique and does not store request secrets', async () => {
      const f = await fixture();
      const [a, b] = await Promise.all([1, 2].map(() => f.service.create({ organizationId: 'tenant-a', name: 'New',
        id: 'injected', sipUsername: 'injected', sipProvider: 'telnyx', loginPassword: 'must-not-store' } as Partial<ExtensionUser>)));
      assert.deepEqual(new Set([a.extension.extension, b.extension.extension]), new Set(['2001', '2002']));
      for (const item of [a.extension, b.extension]) {
        assert.notEqual(item.id, 'injected'); assert.notEqual(item.sipUsername, 'injected');
        assert.equal(item.sipProvider, 'vocivo'); assert.equal('loginPassword' in item, false);
      }
      await assert.rejects(f.service.create({ organizationId: 'tenant-a', name: 'Overflow' }), /no available/);
      assert.equal((await f.service.create({ organizationId: 'tenant-b', name: 'Other' })).extension.extension, '2000');
    });
    await t.test('tenant mismatches and identity reassignment are rejected', async () => {
      const f = await fixture();
      await assert.rejects(f.service.get(employee.id, 'tenant-b'), /not found/);
      await assert.rejects(f.service.update(employee.id, { name: 'Wrong' }, 'tenant-b'), /not found/);
      await assert.rejects(f.service.remove(employee.id, 'tenant-b'), /not found/);
      await assert.rejects(f.service.update(employee.id, { organizationId: 'tenant-b' }, 'tenant-a'), /cannot be changed/);
      const updated = await f.service.update(employee.id, { name: 'Renamed', id: 'injected', sipUsername: 'injected' }, 'tenant-a');
      assert.equal(updated.id, employee.id); assert.equal(updated.sipUsername, employee.sipUsername);
      assert.equal(updated.createdAt, employee.createdAt); assert.equal(updated.name, 'Renamed');
      assert.deepEqual(f.revoked, [employee.id]);
    });
    await t.test('concurrent deletion is never resurrected by an edit', async () => {
      const f = await fixture();
      f.race(async () => { await updateExtensionDirectory(() => [], f.db.transaction, 'vocivo'); });
      await assert.rejects(f.service.update(employee.id, { name: 'Stale' }, 'tenant-a'), /not found/);
      assert.deepEqual(await f.service.list(), []);
    });
    await t.test('partial updates preserve concurrent role and status changes', async () => {
      const f = await fixture();
      f.race(async () => { await updateExtensionDirectory((rows) => rows.map((item) => ({ ...item, status: 'expired', role: 'manager' })), f.db.transaction, 'vocivo'); });
      const updated = await f.service.update(employee.id, { name: 'New name' }, 'tenant-a');
      assert.equal(updated.status, 'expired'); assert.equal(updated.role, 'manager');
    });
    await t.test('revocation failure prevents mutation; deletion removes the current identity', async () => {
      const f = await fixture(); f.failRevocation();
      await assert.rejects(f.service.remove(employee.id, 'tenant-a'), /revocation/);
      await assert.rejects(f.service.update(employee.id, { name: 'Change' }, 'tenant-a'), /revocation/);
      assert.equal((await f.service.get(employee.id)).name, employee.name);
      const g = await fixture();
      await g.service.remove(employee.id, 'tenant-a');
      assert.deepEqual(g.revoked, [employee.id]);
      await assert.rejects(g.service.get(employee.id), /not found/);
      const current = createCurrentExtensionReader({
        readExtensionDirectory: () => g.service.list(),
        readExtensionCredential: async () => { assert.fail('must not read archived carrier credentials'); },
        updateExtensionDirectory: async () => { assert.fail('must not restore deleted identity'); },
      });
      assert.equal(await current(employee.id), null);
    });
    await t.test('individual users cannot request an administrator role', async () => {
      const f = await fixture(); f.config.organizations[1].accountType = 'individual';
      const { extension } = await f.service.create({ organizationId: 'tenant-b', name: 'Individual', role: 'company_owner' });
      assert.equal(extension.role, 'individual');
      assert.equal((await f.service.update(extension.id, { role: 'company_admin' }, 'tenant-b')).role, 'individual');
    });
    await t.test('adopted identities issue device SIP credentials without carrier credentials', async () => {
      const f = await fixture();
      const values = { VOCIVO_VOICE_EDGE: 'sip', VOCIVO_TURN_URLS: 'turn:relay.example:3478', VOCIVO_TURN_SECRET: 'x'.repeat(64), VOCIVO_SIP_REALM: 'sip.example' };
      const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
      Object.assign(process.env, values);
      try {
        const saved: StoredSipCredential[] = [];
        const handler = createSipCredentialsHandler({
          requireSession: async () => ({ sub: employee.id, extensionId: employee.id, organizationId: employee.organizationId,
            iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86400 }) as never,
          readPbxConfig: async () => f.config,
          getExtension: f.service.get,
          accessForSession: async () => ({ superadmin: false, features: { internalCalling: true } }) as never,
          saveSipCredential: async (value) => { saved.push(value); }, revokeSipCredential: async () => undefined,
        });
        let status = 0;
        let payload: { username: string; password: string; realm: string } | undefined;
        const response = { setHeader() {}, status(value: number) { status = value; return this; },
          json(value: typeof payload) { payload = value; return this; } } as unknown as VercelResponse;
        await handler({ method: 'POST', headers: {}, body: { deviceId: 'vocivo-test-device' } } as VercelRequest, response);
        assert.equal(status, 200); assert.ok(payload);
        assert.equal(payload.username, employee.sipUsername);
        assert.equal(saved[0].extensionId, employee.id);
        assert.equal(saved[0].organizationId, employee.organizationId);
        assert.equal(saved[0].ha1, digestHa1(payload.username, payload.realm, payload.password));
        assert.equal('sipPassword' in (await f.service.get(employee.id)), false);
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
    });
    await t.test('incompatible engine settings cannot activate Vocivo authority', () => {
      assert.throws(() => assertVocivoExtensionEngine('telnyx', true), /requires SIP/);
      assert.throws(() => assertVocivoExtensionEngine('sip', false), /requires SIP/);
      assert.doesNotThrow(() => assertVocivoExtensionEngine('sip', true));
    });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = oldSecret;
  }
});

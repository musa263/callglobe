import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { createOwnerPasswordService } from './owner-password.js';
import { readStoredOwnerPasswordHash } from './owner-credential-store.js';

test('a migrated hash preserves the existing password without a carrier or bootstrap dependency', async () => {
  const hash = await bcrypt.hash('Existing-password-123', 4);
  const service = createOwnerPasswordService({ readHash: async () => hash, writeHash: async () => {}, bootstrapHash: () => { throw new Error('bootstrap must not be read'); } });
  assert.equal(await service.readPasswordHash(), hash);
  assert.equal(await bcrypt.compare('Existing-password-123', await service.readPasswordHash()), true);
});

test('database errors never fall back to an old bootstrap password', async () => {
  const service = createOwnerPasswordService({ readHash: async () => { throw new Error('database unavailable'); }, writeHash: async () => {}, bootstrapHash: () => { assert.fail('must fail closed'); } });
  await assert.rejects(service.readPasswordHash(), /database unavailable/);
  await assert.rejects(readStoredOwnerPasswordHash(async () => { throw new Error('database unavailable'); }), /database unavailable/);
});

test('only a missing owner record uses a validated bootstrap hash', async () => {
  const hash = await bcrypt.hash('Bootstrap-password-123', 4);
  const deps = { readHash: async () => null, writeHash: async () => {}, bootstrapHash: () => hash };
  assert.equal(await createOwnerPasswordService(deps).readPasswordHash(), hash);
  assert.equal(await readStoredOwnerPasswordHash(async () => null), null);
  await assert.rejects(createOwnerPasswordService({ ...deps, bootstrapHash: () => 'not-a-hash' }).readPasswordHash(), /configuration is invalid/);
});

test('corrupt stored credentials do not silently become missing credentials', async () => {
  const old = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'test-secret-not-production';
  try { await assert.rejects(readStoredOwnerPasswordHash(async () => Buffer.from('corrupt')), /could not be decrypted/); }
  finally { if (old === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = old; }
});

test('password changes verify the old password and store only a bcrypt hash', async () => {
  let stored = await bcrypt.hash('Existing-password-123', 4);
  let writes = 0;
  const service = createOwnerPasswordService({ readHash: async () => stored, writeHash: async (hash) => { stored = hash; writes++; }, bootstrapHash: () => '' });
  assert.equal(await service.changePassword('wrong', 'New-password-123'), false);
  assert.equal(writes, 0);
  assert.equal(await service.changePassword('Existing-password-123', 'New-password-123'), true);
  assert.equal(writes, 1);
  assert.notEqual(stored, 'New-password-123');
  assert.equal(await bcrypt.compare('New-password-123', stored), true);
  assert.equal(await bcrypt.compare('Existing-password-123', stored), false);
});

test('one-time migration encrypts the existing hash and refuses to replace a credential', async () => {
  const { initializeOwnerPasswordHash } = await import('./owner-credential-store.js');
  const old = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'test-migration-secret-not-production';
  let body: Buffer | undefined;
  const hash = await bcrypt.hash('Unchanged-password-123', 4);
  const create = async (_path: string, value: Buffer, options: { allowOverwrite?: boolean; access?: string }) => {
    assert.equal(options.allowOverwrite, false);
    assert.equal(options.access, 'private');
    if (body) throw new Error('Stored object already exists.');
    body = value;
  };
  try {
    await initializeOwnerPasswordHash(hash, create);
    assert.equal(body!.includes(Buffer.from(hash)), false);
    assert.equal(await readStoredOwnerPasswordHash(async () => body!), hash);
    await assert.rejects(initializeOwnerPasswordHash(hash, create), /already exists/);
    assert.equal(await readStoredOwnerPasswordHash(async () => body!), hash);
    process.env.AUTH_SECRET = 'different-key';
    await assert.rejects(readStoredOwnerPasswordHash(async () => body!), /could not be decrypted/);
  } finally { if (old === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = old; }
});

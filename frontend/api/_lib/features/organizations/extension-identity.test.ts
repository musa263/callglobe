import assert from 'node:assert/strict';
import test from 'node:test';
import { createCurrentExtensionReader } from './extension-identity.js';
import type { ExtensionUser } from './pbx.js';
import type { StoredExtensionCredential } from './extension-store.js';

function fixture() {
  const original: ExtensionUser = { id: 'employee', organizationId: 'tenant-a', extension: '2000',
    name: 'Employee', email: '', mobile: '', department: '', role: 'user', status: 'active', sipUsername: 'legacy' };
  let rows = [original];
  let beforeWrite = () => {};
  let writes = 0;
  const stored: StoredExtensionCredential = { version: 3, syncedAt: new Date().toISOString(),
    extension: { ...original, sipUsername: 'migrated', sipProvider: 'telnyx' },
    sipUsername: 'migrated', sipPassword: 'test-only', provider: 'telnyx' };
  const read = createCurrentExtensionReader({
    readExtensionDirectory: async () => rows.map(item => ({ ...item })),
    readExtensionCredential: async () => ({ ...stored, extension: { ...stored.extension, sipProvider: 'telnyx' as const } }),
    updateExtensionDirectory: async update => { writes++; beforeWrite(); rows = await update(rows); return rows; },
  });
  return { original, stored, read, rows: () => rows, writes: () => writes,
    race: (fn: (rows: ExtensionUser[]) => ExtensionUser[]) => { beforeWrite = () => { rows = fn(rows); }; } };
}

test('persist legacy SIP identity before returning it, without carrier provisioning', async () => {
  const f = fixture();
  assert.equal((await f.read('employee'))?.sipUsername, 'migrated');
  assert.equal(f.rows()[0].sipProvider, 'telnyx');
  await f.read('employee');
  assert.equal(f.writes(), 1);
});

test('migration never changes an already migrated identity', async () => {
  const f = fixture(); f.original.sipProvider = 'telnyx';
  assert.equal((await f.read('employee'))?.sipUsername, 'legacy');
  assert.equal(f.writes(), 0);
});

for (const field of ['id', 'organizationId', 'extension', 'sipUsername'] as const) {
  test(`migration denies mismatched credential ${field}`, async () => {
    const f = fixture(); f.stored.extension[field] = 'different';
    assert.equal(await f.read('employee'), null);
    assert.equal(f.writes(), 0);
  });
}

test('migration cannot resurrect a concurrently deleted employee', async () => {
  const f = fixture(); f.race(() => []);
  assert.equal(await f.read('employee'), null);
});

test('migration preserves concurrent suspension and role changes', async () => {
  const f = fixture(); f.race(rows => rows.map(item => ({ ...item, status: 'expired', role: 'manager' })));
  const result = await f.read('employee');
  assert.equal(result?.status, 'expired'); assert.equal(result?.role, 'manager');
});

for (const field of ['organizationId', 'sipUsername', 'extension'] as const) {
  test(`migration CAS preserves concurrent ${field} change`, async () => {
    const f = fixture(); f.race(rows => rows.map(item => ({ ...item, [field]: 'new-value' })));
    const result = await f.read('employee');
    assert.equal(result?.[field], 'new-value');
    assert.equal(result?.sipProvider, undefined);
  });
}

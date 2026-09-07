import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { VocivoSession } from '../auth/auth.js';
import { defaultPbxConfig } from '../organizations/pbx-config-store.js';
import { createCarrierTrunkStore, normalizeCarrierTrunk } from './carrier-trunk-store.js';
import { createCarrierTrunksHandler } from './routes/admin-carrier-trunks.js';

process.env.AUTH_SECRET = 'carrier-trunk-tests-only';
const draft = () => ({ id: randomUUID(), revision: 0, name: 'Test trunk', provider: 'Test carrier', accountReference: 'ACCOUNT-TEST', server: '192.0.2.1', port: 5060, transport: 'UDP', publicIp: '198.51.100.1', hostingProvider: 'Test host', authentication: 'unconfirmed', numbers: [{ inboundNumber: '0123456789', callerId: '44123456789', destinationType: 'unassigned', destinationId: '' }] });

function memoryStore() {
  const objects = new Map<string, Buffer>();
  let queue = Promise.resolve();
  const deps: Parameters<typeof createCarrierTrunkStore>[0] = {
    readObject: async path => objects.get(path) || null,
    transactObject: async (path, update) => {
      const task = queue.then(async () => { objects.set(path, await update(objects.get(path) || null)); });
      queue = task.catch(() => {}); // Rejected writes must release the test lock.
      await task;
    },
  };
  return { objects, store: createCarrierTrunkStore(deps) };
}

test('carrier configuration stays draft, normalizes caller IDs and rejects malformed destinations', () => {
  const normalized = normalizeCarrierTrunk({ ...draft(), status: 'active', organizationId: 'other', password: 'must-not-persist' }, 'tenant-a');
  assert.equal(normalized.status, 'draft');
  assert.equal(normalized.organizationId, 'tenant-a');
  assert.equal(normalized.numbers[0].callerId, '+44123456789');
  assert.equal(normalized.numbers[0].destinationType, 'unassigned');
  assert.equal('password' in normalized, false);
  for (const patch of [{ port: 0 }, { server: 'sip://user:password@example.com' }, { publicIp: 'invalid' }, { authentication: 'none' }, { transport: 'WSS' }, { numbers: [{ ...draft().numbers[0], destinationType: 'extension' }] }, { numbers: [...draft().numbers, ...draft().numbers] }]) {
    assert.throws(() => normalizeCarrierTrunk({ ...draft(), ...patch }, 'tenant-a'));
  }
});

test('encrypted carrier records are tenant-scoped and fail closed if moved or corrupted', async () => {
  const { store, objects } = memoryStore();
  const input = draft();
  await store.save('tenant-a', input);
  assert.equal((await store.list('tenant-a'))[0].name, input.name);
  assert.deepEqual(await store.list('tenant-b'), []);
  await store.save('tenant-b', { ...draft(), name: 'Tenant B' });
  const [a, b] = [...objects.keys()];
  assert.equal(objects.get(a)!.includes(Buffer.from(input.accountReference)), false);
  objects.set(b, objects.get(a)!);
  await assert.rejects(store.list('tenant-b'), /Invalid carrier trunk storage/);
  objects.set(a, Buffer.from('corrupt'));
  await assert.rejects(store.save('tenant-a', { ...input, revision: 1 }));
  assert.equal(objects.get(a)!.toString(), 'corrupt', 'corruption must not reset the store');
  await assert.rejects(store.list(''));
});

test('carrier edits use revisions, preserve parallel creates and tolerate create retries', async () => {
  const { store } = memoryStore();
  const input = draft();
  const saved = await store.save('tenant-a', input);
  const retried = await store.save('tenant-a', input);
  assert.deepEqual(retried, saved);
  const outcomes = await Promise.allSettled(['First', 'Second'].map(name => store.save('tenant-a', { ...saved, name })));
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(item => item.status === 'rejected').length, 1);
  assert.equal((await store.list('tenant-a'))[0].revision, 2);
  await Promise.all(Array.from({ length: 10 }, () => store.save('tenant-a', draft())));
  assert.equal((await store.list('tenant-a')).length, 11);
  await assert.rejects(store.save('tenant-a', { ...input, revision: 0, name: 'Different retry' }), /another tab/);
});

function routeFixture(session: VocivoSession = { sub: 'company-admin', role: 'company_admin', organizationId: 'primary', accountId: 'admin-a' }, featureEnabled = true) {
  const config = defaultPbxConfig();
  config.organizations.push({ ...config.organizations[0], id: 'second', name: 'Second tenant', slug: 'second' });
  config.callHandling.ringGroups.push({ id: 'primary-group', name: 'Primary group', extension: '3000', strategy: 'ring_all', members: [], timeout: 20, fallback: '' });
  const { store } = memoryStore();
  const handler = createCarrierTrunksHandler({
    requireAdmin: async () => ({ session, superadmin: session.role === 'superadmin', organizationId: session.organizationId }),
    readPbxConfig: async () => config,
    requireFeature: async () => { if (!featureEnabled) throw new Error('Feature not enabled'); return { superadmin: true }; },
    listExtensions: async org => [{ id: `${org}-extension` }] as Awaited<ReturnType<NonNullable<Parameters<typeof createCarrierTrunksHandler>[0]>['listExtensions']>>,
    store,
  });
  async function request(method: string, body?: unknown, organizationId?: string) {
    let status = 200, result: any;
    const res = { setHeader() {}, status(value: number) { status = value; return this; }, json(value: unknown) { result = value; return this; } };
    await handler({ method, body, query: organizationId ? { organizationId } : {}, headers: {} } as VercelRequest, res as unknown as VercelResponse);
    return { status, result };
  }
  return { request, config, store };
}

test('carrier API denies tenant overrides and stores unassigned numbers only in the authenticated company', async () => {
  const { request, store, config } = routeFixture();
  const before = structuredClone(config);
  assert.equal((await request('GET', undefined, 'second')).status, 403);
  assert.equal((await request('PUT', { ...draft(), organizationId: 'second' })).status, 409);
  assert.equal((await request('PUT', draft())).status, 200);
  assert.equal((await request('GET')).result.trunks.length, 1);
  assert.deepEqual(await store.list('second'), []);
  assert.deepEqual(config, before, 'saving a draft must not activate routes or change PBX settings');
  assert.equal((await routeFixture(undefined, false).request('PUT', draft())).status, 403);
});

test('carrier API requires explicit platform workspace and rejects another company destination', async () => {
  const { request } = routeFixture({ sub: 'vocivo-owner', role: 'superadmin' });
  assert.equal((await request('GET')).status, 400);
  assert.equal((await request('PUT', draft())).status, 400);
  for (const [destinationType, destinationId] of [['extension', 'primary-extension'], ['ring_group', 'primary-group']]) {
    const body = { ...draft(), numbers: [{ ...draft().numbers[0], destinationType, destinationId }] };
    assert.equal((await request('PUT', body, 'second')).status, 400);
    assert.equal((await request('PUT', body, 'primary')).status, 200);
  }
});

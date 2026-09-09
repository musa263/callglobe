import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAccessForSession, type VocivoSession } from '../auth/auth.js';
import { defaultPbxConfig, organizationSettingsFrom } from '../organizations/pbx-config-store.js';
import { defaultUserProfile } from '../calling/call-preferences.js';
import { applyNumberRouting, numberRoutingSnapshot, type RoutingUser } from './number-routing.js';
import { createNumberRoutingHandler } from './routes/admin-number-routing.js';

const a = '+12025550101', b = '+12025550102', foreign = '+442079460018';
function fixture() {
  const config = defaultPbxConfig();
  config.organizations.push({ ...config.organizations[0], id: 'other', slug: 'other' });
  config.organizationSettings.other = organizationSettingsFrom(config);
  config.numberAssignments = {
    [a]: { organizationId: 'primary', source: 'owned', destinationType: 'extension', destinationId: 'u1' },
    [b]: { organizationId: 'primary', source: 'owned', destinationType: 'main' },
    [foreign]: { organizationId: 'other', source: 'owned', destinationType: 'extension', destinationId: 'u3' },
  };
  config.userProfiles.u1 = { ...defaultUserProfile(), outboundCallerId: a };
  config.userProfiles.u2 = defaultUserProfile();
  config.userProfiles.u3 = { ...defaultUserProfile(), outboundCallerId: foreign };
  const directory: RoutingUser[] = [
    { id: 'u1', name: 'Alice', extension: '2000', organizationId: 'primary', status: 'active' },
    { id: 'u2', name: 'Bob', extension: '2001', organizationId: 'primary', status: 'active' },
    { id: 'u3', name: 'Other tenant', extension: '2000', organizationId: 'other', status: 'active' },
  ];
  const body = (patch: Record<string, unknown> = {}) => ({ action: 'user', version: numberRoutingSnapshot(config, 'primary', directory).version,
    extensionId: 'u2', inboundNumbers: [b], outboundCallerId: b, confirmReassignment: true, ...patch });
  return { config, directory, body };
}

test('routing reads expose only the selected tenant and no SIP credentials', () => {
  const f = fixture();
  const snapshot = numberRoutingSnapshot(f.config, 'primary', f.directory);
  assert.deepEqual(snapshot.numbers.map(item => item.number), [a, b]);
  assert.deepEqual(snapshot.users.map(item => item.id), ['u1', 'u2']);
  assert(!JSON.stringify(snapshot).includes(foreign));
  assert(!JSON.stringify(snapshot).includes('Other tenant'));
});

test('one patch assigns distinct inbound and outbound numbers without changing another user or tenant', () => {
  const f = fixture(), before = structuredClone(f.config);
  const next = applyNumberRouting(f.config, 'primary', f.directory, f.body());
  assert.equal(next.numberAssignments[b].destinationId, 'u2');
  assert.equal(next.userProfiles?.u2.outboundCallerId, b);
  assert.deepEqual(next.userProfiles?.u1, before.userProfiles.u1);
  assert.deepEqual(next.numberAssignments[foreign], before.numberAssignments[foreign]);
  assert.deepEqual(f.config, before, 'no mutation before transaction commit');
});

test('multiple DIDs resolve to one user and outgoing can inherit company default', () => {
  const f = fixture();
  const patch = applyNumberRouting(f.config, 'primary', f.directory, f.body({ inboundNumbers: [a, b], outboundCallerId: '' }));
  assert.equal(patch.numberAssignments[a].destinationId, 'u2');
  assert.equal(patch.numberAssignments[b].destinationId, 'u2');
  assert.equal(patch.userProfiles?.u2.outboundCallerId, '');
  assert.equal(patch.userProfiles?.u2.did, '');
});

test('reassignment requires confirmation and unchecked direct numbers return to main routing', () => {
  const f = fixture();
  assert.throws(() => applyNumberRouting(f.config, 'primary', f.directory, f.body({ confirmReassignment: false })), /Confirm reassignment/);
  const patch = applyNumberRouting(f.config, 'primary', f.directory, f.body({ extensionId: 'u1', inboundNumbers: [], outboundCallerId: a }));
  assert.equal(patch.numberAssignments[a].destinationType, 'main');
  assert.equal(patch.numberAssignments[a].destinationId, '');
});

test('foreign, disabled, verified-only and wrong-mode inbound lines fail without partial changes', () => {
  for (const variant of ['foreign', 'disabled', 'verified', 'mode']) {
    const f = fixture();
    let number = b;
    if (variant === 'foreign') number = foreign;
    if (variant === 'disabled') f.config.numberAssignments[b].disabled = true;
    if (variant === 'verified') f.config.numberAssignments[b].source = 'verified';
    if (variant === 'mode') f.config.company.callingMode = 'carrier';
    const before = structuredClone(f.config);
    assert.throws(() => applyNumberRouting(f.config, 'primary', f.directory, f.body({ inboundNumbers: [a, number], outboundCallerId: '' })), /inbound number/);
    assert.deepEqual(f.config, before);
  }
});

test('caller IDs, malformed inputs and foreign or suspended users are rejected', () => {
  const f = fixture();
  for (const patch of [{ outboundCallerId: foreign }, { inboundNumbers: 'not-array' }, { inboundNumbers: [42] }, { extensionId: 'u3' }]) {
    assert.throws(() => applyNumberRouting(f.config, 'primary', f.directory, f.body(patch)));
  }
  f.directory[1].status = 'suspended';
  assert.throws(() => applyNumberRouting(f.config, 'primary', f.directory, f.body()), /active user/);
});

test('shared route updates and user assignments are two views of the same record', () => {
  const f = fixture();
  f.config.callHandling.queues.push({ id: 'q1', name: 'Support', extension: '3000', strategy: 'simultaneous', members: ['u1'], maxWait: 30, fallback: '' });
  const patch = applyNumberRouting(f.config, 'primary', f.directory, f.body({ action: 'route', number: a, destinationType: 'queue', destinationId: 'q1' }));
  const snapshot = numberRoutingSnapshot({ ...f.config, ...patch }, 'primary', f.directory);
  assert.equal(snapshot.numbers.find(item => item.number === a)?.destinationType, 'queue');
  assert(!snapshot.numbers.some(item => item.destinationType === 'extension' && item.destinationId === 'u1'));
  assert.throws(() => applyNumberRouting(f.config, 'primary', f.directory, f.body({ action: 'route', number: a, destinationType: 'extension', destinationId: 'u3' })), /destination in this company/);
  assert.throws(() => applyNumberRouting(f.config, 'primary', f.directory, f.body({ action: 'route', number: a, destinationType: 'queue', destinationId: 'foreign-queue' })), /destination in this company/);
});

test('stale routing editors conflict, unrelated tenant and profile changes are preserved', () => {
  const f = fixture(), stale = f.body();
  f.config.numberAssignments[a].destinationType = 'main';
  assert.throws(() => applyNumberRouting(f.config, 'primary', f.directory, stale), /changed/);
  const current = f.body();
  f.config.numberAssignments[foreign].label = 'Foreign update';
  f.config.userProfiles.u2.noAnswerSeconds = 40;
  const patch = applyNumberRouting(f.config, 'primary', f.directory, current);
  assert.equal(patch.userProfiles?.u2.noAnswerSeconds, 40);
  assert.equal(patch.numberAssignments[foreign].label, 'Foreign update');
});

function handlerFixture(session: VocivoSession = { sub: 'vocivo-account:admin', accountId: 'admin', organizationId: 'primary', role: 'company_admin' }) {
  const f = fixture();
  let writes = 0, leased = false, directoryAvailable = true;
  const handler = createNumberRoutingHandler({
    requireAdmin: async () => adminAccessForSession(session),
    readPbxConfig: async () => structuredClone(f.config),
    readExtensionDirectory: async () => directoryAvailable ? f.directory as any : null,
    requireFeature: async () => ({ superadmin: true }),
    acquireTenantMutation: async () => { assert(!leased); leased = true; return async () => { leased = false; return true; }; },
    savePbxConfig: async update => {
      assert(leased, 'extension mutation lock held during assignment');
      const patch = typeof update === 'function' ? update(f.config) : update;
      Object.assign(f.config, patch); writes++; return f.config;
    },
  });
  return { ...f, get writes() { return writes; }, get leased() { return leased; }, unavailable() { directoryAvailable = false; },
    async request(method: string, organizationId: string | undefined = 'primary', body?: Record<string, unknown>) {
      let status = 200, result: any;
      const res = { setHeader() {}, status(code: number) { status = code; return res; }, json(value: unknown) { result = value; return res; } } as unknown as VercelResponse;
      await handler({ method, query: organizationId ? { organizationId } : {}, body } as VercelRequest, res);
      return { status, body: result };
    },
  };
}

test('endpoint performs exactly one atomic save and releases the user mutation lock', async () => {
  const f = handlerFixture();
  const stale = f.body();
  assert.equal((await f.request('PUT', 'primary', stale)).status, 200);
  assert.equal(f.writes, 1); assert.equal(f.leased, false);
  assert.equal((await f.request('PUT', 'primary', stale)).status, 409);
  assert.equal(f.writes, 1); assert.equal(f.leased, false);
});

test('employee cannot read or update number assignments', async () => {
  const f = handlerFixture({ sub: 'vocivo-extension:u1', extensionId: 'u1', organizationId: 'primary', role: 'user' });
  assert.equal((await f.request('GET')).status, 403);
  assert.equal((await f.request('PUT', 'primary', f.body())).status, 403);
  assert.equal(f.writes, 0);
});

test('company admin cannot target foreign tenant and superadmin must explicitly select a workspace', async () => {
  const f = handlerFixture();
  assert.equal((await f.request('GET', 'other')).status, 403);
  assert.equal((await f.request('PUT', 'primary', f.body({ organizationId: 'other' }))).status, 409);
  const platform = handlerFixture({ sub: 'vocivo-owner', role: 'superadmin' });
  assert.equal((await platform.request('GET', '')).status, 400);
  assert.equal((await platform.request('PUT', 'primary', platform.body())).status, 200);
  assert.deepEqual((await platform.request('GET', 'other')).body.numbers.map((item: any) => item.number), [foreign]);
});

test('unavailable directory fails closed without mutation', async () => {
  const f = handlerFixture(); f.unavailable();
  assert.equal((await f.request('PUT', 'primary', f.body())).status, 503);
  assert.equal(f.writes, 0); assert.equal(f.leased, false);
});

test('legacy unclassified caller IDs cannot be promoted to inbound numbers', () => {
  const f = fixture();
  f.config.numberAssignments[b] = { organizationId: 'primary' };
  assert.equal(numberRoutingSnapshot(f.config, 'primary', f.directory).numbers.find(item => item.number === b)?.source, 'verified');
  assert.throws(() => applyNumberRouting(f.config, 'primary', f.directory, f.body()), /inbound number/);
});

test('removal clears matching caller IDs and retains a tenant-owned tombstone in the same transaction', async () => {
  const f = handlerFixture();
  f.config.company.defaultCallerId = a;
  const result = await f.request('PUT', 'primary', f.body({ action: 'remove', number: a }));
  assert.equal(result.status, 200);
  assert.equal(f.config.numberAssignments[a].disabled, true);
  assert.equal(f.config.userProfiles.u1.outboundCallerId, '');
  assert.equal(f.config.company.defaultCallerId, '');
  assert.equal(f.config.numberAssignments[foreign].disabled, undefined);
  assert.equal(f.writes, 1);
  assert.equal((await f.request('PUT', 'primary', f.body({ action: 'remove', number: foreign }))).status, 400);
  assert.equal(f.writes, 1);
});

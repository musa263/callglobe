import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminPbxHandler } from './admin-pbx.js';
import { defaultPbxConfig, organizationSettingsFrom, pbxForOrganization, PbxConfigConflictError, type PbxConfig } from '../pbx-config-store.js';

function fixture(companyAdmin = false) {
  let config = defaultPbxConfig();
  config.organizations.push({ ...config.organizations[0], id: 'second', name: 'Second Company' });
  config.organizationSettings.second = organizationSettingsFrom(pbxForOrganization(config, 'second'));
  let writes = 0;
  let conflict = false;
  const handler = createAdminPbxHandler({
    requireAdmin: async () => ({ superadmin: !companyAdmin, organizationId: companyAdmin ? 'primary' : undefined, session: companyAdmin
      ? { sub: 'vocivo-account:a', role: 'company_admin', organizationId: 'primary' }
      : { sub: 'vocivo-owner', role: 'superadmin' } }),
    readPbxConfig: async () => structuredClone(config),
    savePbxConfig: async (update, options) => {
      if (conflict || options?.expectedUpdatedAt !== config.updatedAt) throw new PbxConfigConflictError();
      writes++;
      config = { ...config, ...(typeof update === 'function' ? update(config) : update), updatedAt: new Date().toISOString() };
      return structuredClone(config);
    },
    listExtensions: async () => [],
    requireFeature: async () => ({ superadmin: true }),
  });
  return {
    get config() { return config; }, get writes() { return writes; },
    conflict() { conflict = true; },
    async request(method: string, organizationId?: string, body?: Partial<PbxConfig>) {
      let status = 200, response: any;
      const res = { setHeader() {}, status(code: number) { status = code; return res; }, json(value: unknown) { response = value; return res; } } as unknown as VercelResponse;
      await handler({ method, query: organizationId ? { organizationId } : {}, body } as VercelRequest, res);
      return { status, body: response };
    },
  };
}

test('two superadmin tabs save only their own workspace without changing platform selection', async () => {
  const f = fixture();
  const a = await f.request('GET', 'primary');
  const b = await f.request('GET', 'second');
  assert.equal(f.writes, 0, 'opening another tenant must be read-only');
  assert.equal(b.body.config.activeOrganizationId, 'second');
  assert.equal(f.config.activeOrganizationId, 'primary');
  b.body.config.company.timezone = 'Europe/London';
  b.body.config.organizations[0].name = 'Stale foreign name';
  b.body.config.platform.controlPlane = 'stale platform setting';
  assert.equal((await f.request('PUT', 'second', b.body.config)).status, 200);
  a.body.config.company.timezone = 'Africa/Lagos';
  assert.equal((await f.request('PUT', 'primary', a.body.config)).status, 200);
  assert.equal(pbxForOrganization(f.config, 'second').company.timezone, 'Europe/London');
  assert.equal(pbxForOrganization(f.config, 'primary').company.timezone, 'Africa/Lagos');
  assert.equal(f.config.organizations[0].name, 'Global Heritage');
  assert.equal(f.config.platform.controlPlane, defaultPbxConfig().platform.controlPlane);
  assert.equal(f.config.activeOrganizationId, 'primary');
});

test('ambiguous and mismatched forms fail before any database mutation', async () => {
  const f = fixture();
  assert.equal((await f.request('PUT', undefined, { activeOrganizationId: 'second' })).status, 400);
  assert.equal((await f.request('PUT', 'missing', {})).status, 404);
  assert.equal((await f.request('PUT', 'second', { activeOrganizationId: 'primary' })).status, 409);
  assert.equal(f.writes, 0);
});

test('company administrator cannot select another customer and receives a scoped response', async () => {
  const f = fixture(true);
  assert.equal((await f.request('GET', 'second')).status, 403);
  assert.equal((await f.request('PUT', 'second', {})).status, 403);
  const own = await f.request('GET');
  assert.equal(own.status, 200);
  assert.deepEqual(own.body.config.organizations.map((item: { id: string }) => item.id), ['primary']);
  assert.equal(own.body.config.organizationSettings, undefined);
  assert.equal(own.body.config.platform, undefined);
  assert.equal(f.writes, 0);
});

test('non-default workspace routing still validates extension ownership', async () => {
  const f = fixture();
  const b = (await f.request('GET', 'second')).body.config;
  b.callHandling.ringGroups = [{ members: ['foreign-extension'] }];
  assert.equal((await f.request('PUT', 'second', b)).status, 400);
  assert.equal(f.writes, 0);
});

test('a concurrent database change returns conflict instead of overwriting', async () => {
  const f = fixture();
  const b = (await f.request('GET', 'second')).body.config;
  f.conflict();
  assert.equal((await f.request('PUT', 'second', b)).status, 409);
  assert.equal(f.writes, 0);
});

test('a stale form for the same tenant is rejected but other tenant saves do not invalidate it', async () => {
  const f = fixture();
  const first = (await f.request('GET', 'primary')).body.config;
  const stale = structuredClone(first);
  first.company.timezone = 'Africa/Lagos';
  assert.equal((await f.request('PUT', 'primary', first)).status, 200);
  stale.company.timezone = 'Europe/London';
  assert.equal((await f.request('PUT', 'primary', stale)).status, 409);
  assert.equal(pbxForOrganization(f.config, 'primary').company.timezone, 'Africa/Lagos');
});

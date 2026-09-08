import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAdminPbxHandler } from './admin-pbx.js';
import { defaultPbxConfig, organizationSettingsFrom, pbxForOrganization, PbxConfigConflictError, type PbxConfig } from '../pbx-config-store.js';

function fixture(companyAdmin = false, extensionIds: string[] = []) {
  let config = defaultPbxConfig();
  config.company.name = 'Global Heritage';
  config.organizations[0].name = 'Global Heritage';
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
    listExtensions: async () => extensionIds.map(id => ({ id, organizationId: 'primary', status: 'active' })) as any,
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

test('both company and platform admins can assign only enabled numbers from the selected company', async () => {
  for (const companyAdmin of [true, false]) {
    const f = fixture(companyAdmin, ['employee']);
    f.config.numberAssignments = {
      '+12025550123': { organizationId: 'primary', source: 'owned' },
      '+442079460018': { organizationId: 'second', source: 'owned' },
      '+12025550124': { organizationId: 'primary', source: 'owned', disabled: true },
    };
    const loaded = await f.request('GET', 'primary');
    for (const outboundCallerId of ['+442079460018', '+12025550124', '+12025550199']) {
      loaded.body.config.userProfiles.employee = { outboundCallerId };
      assert.equal((await f.request('PUT', 'primary', loaded.body.config)).status, 400);
    }
    assert.equal(f.writes, 0);
    loaded.body.config.userProfiles.employee = { outboundCallerId: '+12025550123' };
    assert.equal((await f.request('PUT', 'primary', loaded.body.config)).status, 200);
    assert.equal(f.writes, 1);
  }
});

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

test('Global Heritage admin cannot overwrite platform authority or another tenant through PBX settings', async () => {
  const f = fixture(true);
  const own = (await f.request('GET')).body.config;
  const platform = structuredClone(f.config.platform);
  const other = structuredClone(f.config.organizations[1]);
  own.platform = { controlPlane: 'global-heritage', voiceProvider: 'custom' };
  own.legacyPrimaryOrganizationId = 'second';
  own.extension_authority = 'telnyx';
  own.authority = 'global-heritage';
  own.organizations.push({ ...other, name: 'Unauthorized rename' });
  own.organizations[0].extensionEnd = 99999;
  assert.equal((await f.request('PUT', 'primary', own)).status, 200);
  assert.deepEqual(f.config.platform, platform);
  assert.deepEqual(f.config.organizations[1], other);
  assert.equal(f.config.organizations[0].extensionEnd, 2019);
  assert.equal(f.config.legacyPrimaryOrganizationId, undefined);
  assert.equal('authority' in f.config, false);
  assert.equal('extension_authority' in f.config, false);
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

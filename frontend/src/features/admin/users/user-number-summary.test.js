import assert from 'node:assert/strict';
import test from 'node:test';
import { userNumberSummary } from './user-number-summary.js';
import { workspaceApi } from '../workspace-api.js';

test('table derives direct inbound numbers, not legacy DID metadata or another tenant', () => {
  const config = { activeOrganizationId: 'a', company: { defaultCallerId: '+12025550102' }, userProfiles: { u: { did: '+19999999999' } }, numberAssignments: {
    '+12025550101': { organizationId: 'a', destinationType: 'extension', destinationId: 'u' },
    '+12025550102': { organizationId: 'a', destinationType: 'main' },
    '+12025550103': { organizationId: 'a', destinationType: 'extension', destinationId: 'u', disabled: true },
    '+442079460018': { organizationId: 'other', destinationType: 'extension', destinationId: 'u' },
  } };
  assert.deepEqual(userNumberSummary(config, 'u'), { inbound: ['+12025550101'], outbound: '+12025550102', inherited: true, unavailable: false });
  config.userProfiles.u.outboundCallerId = '+12025550103';
  assert.equal(userNumberSummary(config, 'u').unavailable, true);
});

test('number routing is explicitly scoped in platform tabs and rejects stale workspace callbacks', async () => {
  let current = true;
  const paths = [];
  const api = workspaceApi(async path => { paths.push(path); return {}; }, 'customer', () => current);
  await api('/api/admin/number-routing');
  await api('/api/admin/number-routing', { method: 'PUT', body: {} });
  assert.deepEqual(paths, ['/api/admin/number-routing?organizationId=customer', '/api/admin/number-routing?organizationId=customer']);
  current = false;
  await assert.rejects(api('/api/admin/number-routing'), /workspace changed/);
  assert.equal(paths.length, 2);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPbxConfig } from './pbx-config-store.js';
import { numberOrganizationId, normalizeE164, organizationForInboundNumber, sessionOrganizationId } from './tenancy.js';
import { assertTenantRowOwnership } from './object-store.js';
import type { VocivoSession } from './auth.js';

test('normalizes public numbers and never assigns an unallocated service number', () => {
  const config = defaultPbxConfig();
  assert.equal(normalizeE164('+1 (844) 716-1777'), '+18447161777');
  assert.equal(numberOrganizationId('+18447161777', config), '');
  assert.equal(organizationForInboundNumber('+18447161777', config), '');
  assert.equal(organizationForInboundNumber('+15550001111', config), '');
});

test('returns only explicit customer number assignments', () => {
  const config = defaultPbxConfig();
  config.numberAssignments['+15673860174'] = { organizationId: 'primary' };
  assert.equal(numberOrganizationId('+1 (567) 386-0174', config), 'primary');
});

test('tenant sessions fail closed without a verified organization claim', () => {
  const config = defaultPbxConfig();
  const missing = { sub: 'vocivo-extension:test' } as VocivoSession;
  const unknown = { sub: 'vocivo-extension:test', organizationId: 'another-company' } as VocivoSession;
  assert.throws(() => sessionOrganizationId(missing, config), /Unauthorized/);
  assert.throws(() => sessionOrganizationId(unknown, config), /Unauthorized/);
  assert.equal(sessionOrganizationId({ ...missing, organizationId: 'primary' }, config), 'primary');
});

test('database tenant guards reject rows owned by another company', () => {
  assert.doesNotThrow(() => assertTenantRowOwnership('company-a', 'company-a'));
  assert.throws(() => assertTenantRowOwnership('company-a', 'company-b'), /isolation violation/);
  assert.throws(() => assertTenantRowOwnership('', 'company-b'), /isolation violation/);
});

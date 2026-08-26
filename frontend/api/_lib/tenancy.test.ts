import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPbxConfig } from './pbx-config-store.js';
import { numberOrganizationId, normalizeE164, organizationForInboundNumber } from './tenancy.js';

test('normalizes public numbers without assigning an unallocated service number', () => {
  const config = defaultPbxConfig();
  assert.equal(normalizeE164('+1 (844) 716-1777'), '+18447161777');
  assert.equal(numberOrganizationId('+18447161777', config), '');
  assert.equal(organizationForInboundNumber('+18447161777', config, '+18447161777'), 'primary');
  assert.equal(organizationForInboundNumber('+15550001111', config, '+18447161777'), '');
});

test('returns only explicit customer number assignments', () => {
  const config = defaultPbxConfig();
  config.numberAssignments['+15673860174'] = { organizationId: 'primary' };
  assert.equal(numberOrganizationId('+1 (567) 386-0174', config), 'primary');
});

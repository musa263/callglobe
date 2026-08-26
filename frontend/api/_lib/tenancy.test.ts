import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPbxConfig } from './pbx-config-store.js';
import { numberOrganizationId, sessionCanAccessNumber } from './tenancy.js';

test('does not assign an unallocated carrier number to the first customer', () => {
  const config = defaultPbxConfig();
  assert.equal(numberOrganizationId('+18447161777', config), '');
  assert.equal(sessionCanAccessNumber({ sub: 'vocivo-extension:user', organizationId: 'primary' }, '+18447161777', config), false);
});

test('allows a tenant to use only an explicitly assigned number', () => {
  const config = defaultPbxConfig();
  config.numberAssignments['+15673860174'] = { organizationId: 'primary', destinationType: 'main' };
  assert.equal(sessionCanAccessNumber({ sub: 'vocivo-extension:user', organizationId: 'primary' }, '+15673860174', config), true);
  assert.equal(sessionCanAccessNumber({ sub: 'vocivo-owner' }, '+18447161777', config), true);
});

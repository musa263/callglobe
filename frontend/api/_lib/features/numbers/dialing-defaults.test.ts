import assert from 'node:assert/strict';
import test from 'node:test';
import { dialingDefaults, validateOutgoingLine } from './dialing-defaults.js';
import { defaultPbxConfig, type PbxConfig } from '../organizations/pbx-config-store.js';
import type { CarrierTrunk } from './carrier-trunk-store.js';

function fixture() {
  const config = defaultPbxConfig();
  config.organizations[0].accountType = 'business';
  config.company.defaultCallerId = '+12025550123';
  config.numberAssignments = { '+12025550123': { organizationId: 'primary', source: 'owned' }, '+442079460018': { organizationId: 'primary', source: 'owned' }, '+966535548337': { organizationId: 'other', source: 'owned' } };
  config.userProfiles.employee = { outboundCallerId: '+442079460018' } as PbxConfig['userProfiles'][string];
  return config;
}
test('assigned employee line wins over company default and determines national dialing', () => {
  const config = fixture();
  assert.deepEqual(dialingDefaults(config, 'primary', 'employee'), { callerId: '+442079460018', country: 'GB' });
  assert.deepEqual(dialingDefaults(config, 'primary', 'unassigned'), { callerId: '+12025550123', country: 'US' });
});
test('missing, disabled and foreign assignments fail closed, without first-inventory fallback', () => {
  const config = fixture();
  for (const line of ['+966535548337', '+442079460099']) {
    config.userProfiles.employee.outboundCallerId = line;
    assert.equal(dialingDefaults(config, 'primary', 'employee').callerId, null);
    assert.throws(() => validateOutgoingLine(config, 'primary', line));
  }
  config.userProfiles.employee.outboundCallerId = '+442079460018';
  config.numberAssignments['+442079460018'].disabled = true;
  assert.equal(dialingDefaults(config, 'primary', 'employee').callerId, null);
  assert.throws(() => validateOutgoingLine(config, 'primary', '+442079460018'));
  config.company.defaultCallerId = '';
  assert.equal(dialingDefaults(config, 'primary', 'unassigned').callerId, null);
});
test('national dialing uses only the assigned, matching tenant trunk revision', () => {
  const config = fixture();
  config.company.callingMode = 'carrier';
  config.numberAssignments['+442079460018'] = { organizationId: 'primary', source: 'carrier', carrierTrunkId: 'trunk', carrierTrunkRevision: 3 };
  const trunk = { id: 'trunk', organizationId: 'primary', revision: 3, mainNumber: '0135110000', numbers: [{ inboundNumber: '0135110000', callerId: '+966135110000' }] } as CarrierTrunk;
  assert.equal(dialingDefaults(config, 'primary', 'employee', [trunk]).country, 'SA');
  assert.equal(dialingDefaults(config, 'primary', 'employee', [{ ...trunk, organizationId: 'other' }]).country, 'GB');
  assert.equal(dialingDefaults(config, 'primary', 'employee', [{ ...trunk, revision: 2 }]).country, 'GB');
  assert.throws(() => validateOutgoingLine(config, 'primary', '+12025550123'));
});

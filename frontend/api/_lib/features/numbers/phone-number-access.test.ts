import assert from 'node:assert/strict';
import test from 'node:test';
import { assignedNumbersForOrganization, callerIdBelongsToOrganization } from './phone-number-access.js';
import { defaultPbxConfig } from '../organizations/pbx-config-store.js';

test('authorizes only an explicitly assigned tenant caller ID', () => {
  const assignments = {
    '+15551234567': { organizationId: 'company-a' },
    '+15557654321': { organizationId: 'company-b' },
  };
  assert.equal(callerIdBelongsToOrganization('+1 (555) 123-4567', 'company-a', assignments), true);
  assert.equal(callerIdBelongsToOrganization('+1 (555) 123-4567', 'company-b', assignments), false);
  assert.equal(callerIdBelongsToOrganization('+15550000000', 'company-a', assignments), false);
});

test('builds the login caller-ID list without querying carrier inventory', () => {
  const config = defaultPbxConfig();
  config.numberAssignments = {
    '+12025550101': { organizationId: 'primary', source: 'owned', destinationType: 'main', messagingEnabled: true },
    '+966535548337': { organizationId: 'primary', source: 'verified' },
    '+442071838750': { organizationId: 'other', source: 'owned', destinationType: 'main' },
  };
  const numbers = assignedNumbersForOrganization(config, 'primary');
  assert.deepEqual(numbers.map((item) => ({ phone: item.phone_number, source: item.source, inbound: item.receives_calls, sms: item.messaging_enabled })), [
    { phone: '+12025550101', source: 'owned', inbound: true, sms: true },
    { phone: '+966535548337', source: 'verified', inbound: false, sms: false },
  ]);
});

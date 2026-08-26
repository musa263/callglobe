import assert from 'node:assert/strict';
import test from 'node:test';
import { callerIdBelongsToOrganization } from './phone-number-access.js';

test('authorizes only an explicitly assigned tenant caller ID', () => {
  const assignments = {
    '+15551234567': { organizationId: 'company-a' },
    '+15557654321': { organizationId: 'company-b' },
  };
  assert.equal(callerIdBelongsToOrganization('+1 (555) 123-4567', 'company-a', assignments), true);
  assert.equal(callerIdBelongsToOrganization('+1 (555) 123-4567', 'company-b', assignments), false);
  assert.equal(callerIdBelongsToOrganization('+15550000000', 'company-a', assignments), false);
});

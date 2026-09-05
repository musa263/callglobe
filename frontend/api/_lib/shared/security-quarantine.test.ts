import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizedQuarantineEvent } from './security-quarantine.js';

test('normalizes quarantine metadata without assigning a customer tenant', () => {
  const event = normalizedQuarantineEvent({
    source: 'telnyx-messaging',
    reason: 'unresolved_number_ownership',
    eventId: ' event-1\n',
    details: { destination: '+15551234567', unsafe: 'line\nbreak' },
  });
  assert.equal(event.eventId, 'event-1');
  assert.equal(event.details.unsafe, 'line break');
  assert.equal('organizationId' in event, false);
});

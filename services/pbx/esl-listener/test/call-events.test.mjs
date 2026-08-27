import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEslEvent, shouldPushIncomingCall } from '../src/call-events.mjs';

test('normalizes the extension B-leg and marks it for one incoming push', () => {
  const call = normalizeEslEvent({
    'Event-Name': 'CHANNEL_CREATE',
    'Event-UUID': 'event-1',
    'Unique-ID': 'call-1',
    'Call-Direction': 'outbound',
    variable_vocivo_call_id: 'call-1',
    variable_vocivo_organization_id: 'global-heritage',
    variable_vocivo_push_target_extension: '2001',
    variable_vocivo_caller_name: 'Mousa',
    variable_vocivo_caller_extension: '2000',
  });
  assert.equal(call.targetExtension, '2001');
  assert.equal(call.caller.name, 'Mousa');
  assert.equal(shouldPushIncomingCall(call), true);
});

test('does not push a carrier leg without a target extension', () => {
  const call = normalizeEslEvent({ 'Event-Name': 'CHANNEL_CREATE', 'Unique-ID': 'call-2', 'Call-Direction': 'outbound' });
  assert.equal(shouldPushIncomingCall(call), false);
});

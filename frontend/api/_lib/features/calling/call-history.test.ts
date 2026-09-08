import assert from 'node:assert/strict';
import test from 'node:test';
import { callHistoryFromEvents } from './call-history.js';
import type { StoredCallEvent } from './call-event-store.js';

const event = (change: Partial<StoredCallEvent>): StoredCallEvent => ({
  id: crypto.randomUUID(), name: 'call.initiated', type: 'webhook', event_timestamp: '2026-08-25T10:00:00.000Z',
  call_session_id: 'session-1', organizationId: 'primary', direction: 'outgoing', from: '+18447161777', to: '+2348012345678', flow: 'outbound_destination',
  ...change,
});

test('builds one completed outgoing call from carrier events', () => {
  const result = callHistoryFromEvents([
    event({}),
    event({ name: 'call.answered', event_timestamp: '2026-08-25T10:00:05.000Z' }),
    event({ name: 'call.hangup', event_timestamp: '2026-08-25T10:01:05.000Z', hangup_cause: 'normal_clearing' }),
  ], 'primary');
  assert.equal(result.length, 1);
  assert.equal(result[0].destination_number, '+2348012345678');
  assert.equal(result[0].duration_seconds, 60);
  assert.equal(result[0].status, 'completed');
});

test('keeps tenants separate and marks unanswered incoming calls missed', () => {
  const result = callHistoryFromEvents([
    event({ direction: 'incoming', flow: undefined, from: '+966500000001', to: '+18447161777', hangup_cause: undefined }),
    event({ name: 'call.hangup', direction: 'incoming', flow: undefined, from: '+966500000001', to: '+18447161777', event_timestamp: '2026-08-25T10:00:20.000Z', hangup_cause: 'originator_cancel' }),
    event({ organizationId: 'another' }),
  ], 'primary');
  assert.equal(result.length, 1);
  assert.equal(result[0].direction, 'incoming');
  assert.equal(result[0].status, 'missed');
});

test('keeps extension-originated PSTN calls on the public number history path', () => {
  const result = callHistoryFromEvents([
    event({ flow: 'outbound', sourceExtensionId: 'musa', sourceExtension: '2000' }),
    event({ name: 'call.answered', flow: 'outbound_destination', sourceExtensionId: 'musa', event_timestamp: '2026-08-25T10:00:05.000Z' }),
    event({ name: 'call.hangup', flow: 'outbound_destination', sourceExtensionId: 'musa', event_timestamp: '2026-08-25T10:01:05.000Z', hangup_cause: 'normal_clearing' }),
  ], 'primary', 100, { extensionId: 'musa' });
  assert.equal(result.length, 1);
  assert.equal(result[0].destination_number, '+2348012345678');
  assert.equal(result[0].internal, undefined);
});

test('does not expose internal agent legs as separate recent calls', () => {
  assert.deepEqual(callHistoryFromEvents([event({ direction: 'outgoing', flow: 'agent', to: 'sip:user@sip.telnyx.com' })], 'primary'), []);
});

test('shows the colleague name and extension to each participant in an internal call', () => {
  const events = [
    event({ flow: 'internal', sourceExtensionId: 'musa', sourceExtension: '2000', sourceName: 'Musa Usman', destinationExtensionId: 'othman', destinationExtension: '2001', destinationName: 'Othman Uthman' }),
    event({ name: 'call.answered', flow: 'outbound_destination', sourceExtensionId: 'musa', sourceExtension: '2000', sourceName: 'Musa Usman', destinationExtensionId: 'othman', destinationExtension: '2001', destinationName: 'Othman Uthman' }),
    event({ name: 'call.hangup', event_timestamp: '2026-08-25T10:01:00.000Z', flow: 'outbound_destination', sourceExtensionId: 'musa', sourceExtension: '2000', sourceName: 'Musa Usman', destinationExtensionId: 'othman', destinationExtension: '2001', destinationName: 'Othman Uthman' }),
  ];
  const caller = callHistoryFromEvents(events, 'primary', 100, { extensionId: 'musa' })[0];
  const recipient = callHistoryFromEvents(events, 'primary', 100, { extensionId: 'othman' })[0];
  assert.equal(caller.destination_name, 'Othman Uthman');
  assert.equal(caller.destination_number, '2001');
  assert.equal(caller.direction, 'outgoing');
  assert.equal(recipient.destination_name, 'Musa Usman');
  assert.equal(recipient.destination_number, '2000');
  assert.equal(recipient.direction, 'incoming');
  assert.equal(recipient.internal, true);
});

test('legacy bare SIP usernames and polluted extension fields resolve only against the viewer directory', () => {
  const username = 'gencred-test-123456';
  const events = [event({ flow: 'internal', from: username, to: 'sip:bob@sip.example', sourceExtension: username, sourceName: 'Mousa', destinationExtension: '2001' })];
  const directory = [{ id: 'mousa', extension: '2000', name: 'Mousa', sipUsername: username }, { id: 'bob', extension: '2001', name: 'Bob', sipUsername: 'bob' }];
  const [call] = callHistoryFromEvents(events, 'primary', 100, { extensionId: 'bob', directory });
  assert.equal(call.destination_number, '2000');
  assert.equal(call.destination_name, 'Mousa');
  assert.ok(!JSON.stringify(call).includes(username));
  const [withoutDirectory] = callHistoryFromEvents(events, 'primary');
  assert.ok(!JSON.stringify(withoutDirectory).includes(username));
  assert.deepEqual(callHistoryFromEvents(events, 'other-tenant', 100, { directory }), []);
});

test('unclassified SIP identities never appear as phone numbers in server history', () => {
  const [call] = callHistoryFromEvents([event({ direction: 'incoming', flow: 'inbound_root', from: 'gencred-opaque-1234' })], 'primary');
  assert.equal(call.destination_number, '');
  assert.equal(call.destination_name, 'Unknown caller');
});

test('authorized admin with an extension can view colleagues internal calls', () => {
  const events = [event({ flow:'internal', sourceExtensionId:'alice', destinationExtensionId:'bob', sourceExtension:'2001', destinationExtension:'2002' })];
  assert.equal(callHistoryFromEvents(events, 'primary', 100, {viewAll:true, extensionId:'admin'}).length, 1);
  assert.equal(callHistoryFromEvents(events, 'primary', 100, {viewAll:false, extensionId:'admin'}).length, 0);
  assert.equal(callHistoryFromEvents(events, 'another', 100, {viewAll:true, extensionId:'admin'}).length, 0);
});

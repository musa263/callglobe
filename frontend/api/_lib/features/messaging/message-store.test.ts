import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { messageForViewer, mergeMessageEvent, storeMessageEvent, type StoredMessage } from './message-store.js';
import { telnyxMessageEvent } from './telnyx-message-event.js';
import type { ObjectGroupMutation, transactObjectGroup } from '../../shared/object-store.js';

const internalMessage: StoredMessage = {
  id: 'message-1',
  to: '2001',
  from: '2000',
  text: 'Hello',
  direction: 'outbound',
  status: 'sent',
  createdAt: '2026-08-26T10:00:00.000Z',
  updatedAt: '2026-08-26T10:00:00.000Z',
  organizationId: 'global-heritage',
  transport: 'internal',
  senderExtensionId: 'ext-musa',
  senderExtension: '2000',
  senderName: 'Musa Usman',
  recipientExtensionId: 'ext-othman',
  recipientExtension: '2001',
  recipientName: 'Othman Uthman',
};

describe('messageForViewer', () => {
  it('shows the recipient to the sender', () => {
    assert.deepEqual(messageForViewer(internalMessage, 'ext-musa'), {
      ...internalMessage,
      direction: 'outbound',
      contactName: 'Othman Uthman',
      to: 'extension:2001',
      from: 'extension:2000',
    });
  });

  it('shows the sender to the recipient', () => {
    assert.deepEqual(messageForViewer(internalMessage, 'ext-othman'), {
      ...internalMessage,
      direction: 'inbound',
      contactName: 'Musa Usman',
      to: 'extension:2001',
      from: 'extension:2000',
    });
  });

  it('does not expose internal messages to unrelated extensions', () => {
    assert.equal(messageForViewer(internalMessage, 'ext-unrelated'), null);
  });
});

it('preserves finalized delivery across reordered sent and API response events', () => {
  const event = (type: string, time: string, status: string) => telnyxMessageEvent({ id: type, event_type: type,
    occurred_at: time, payload: { id: 'sms-1', from: '+15550000000', to: [{ phone_number: '+15550000001', status }], text: 'fixture' } }, 'company-a');
  const failed = event('message.finalized', '2026-09-07T12:00:02Z', 'delivery_failed');
  const sent = event('message.sent', '2026-09-07T12:00:01Z', 'sent');
  for (const events of [[sent, failed], [failed, sent], [failed, { ...sent, updatedAt: '2026-09-07T12:00:03.000Z' }]]) {
    const merged = events.reduce<StoredMessage | undefined>((previous, next) => mergeMessageEvent(previous, next), undefined)!;
    assert.equal(merged.status, 'failed');
    assert.equal(merged.error, 'Message delivery failed.');
  }
  const delivered = event('message.finalized', '2026-09-07T12:00:04Z', 'delivered');
  assert.equal(mergeMessageEvent(failed, delivered).status, 'delivered');
  assert.equal(mergeMessageEvent(failed, delivered).error, undefined);
  assert.throws(() => mergeMessageEvent(failed, { ...sent, organizationId: 'company-b' }), /ownership/);
});

it('repeated provider deliveries occupy one record and one history slot', async () => {
  const oldSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'unit-test-message-encryption';
  const objects = new Map<string, { body: Buffer; etag: string }>();
  const transaction = (async (_lock: string, _paths: string[], update: (objects: Map<string, { body: Buffer; etag: string }>) => ObjectGroupMutation<unknown> | Promise<ObjectGroupMutation<unknown>>) => {
    const mutation = await update(objects);
    for (const entry of mutation.puts || []) objects.set(entry.pathname, { body: entry.value as Buffer, etag: 'fixture' });
    for (const path of mutation.deletes || []) objects.delete(path);
    return mutation.result;
  }) as typeof transactObjectGroup;
  try {
    const event: StoredMessage = { ...internalMessage, transport: 'sms', terminal: true, status: 'failed', providerEventId: 'provider-1' };
    for (let index = 0; index < 20; index++) await storeMessageEvent(event, transaction);
    assert.equal(objects.size, 2);
    await storeMessageEvent({ ...event, status: 'sent', terminal: false, updatedAt: '2026-09-07T00:00:00.000Z' }, transaction);
    assert.equal(objects.size, 2);
    await storeMessageEvent({ ...event, organizationId: 'other-company' }, transaction);
    assert.equal(objects.size, 4, 'same carrier ID cannot overwrite another tenant');
  } finally {
    if (oldSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = oldSecret;
  }
});

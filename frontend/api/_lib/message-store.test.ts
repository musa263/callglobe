import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { messageForViewer, type StoredMessage } from './message-store.js';

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

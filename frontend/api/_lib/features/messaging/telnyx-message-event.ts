import type { StoredMessage } from './message-store.js';

export function telnyxMessageEvent(data: any, organizationId: string): StoredMessage {
  const payload = data.payload || {};
  const recipient = Array.isArray(payload.to) ? payload.to[0] : null;
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const delivery = String(recipient?.status || '').toLowerCase();
  const inbound = data.event_type === 'message.received' || payload.direction === 'inbound';
  const failed = errors.length > 0 || ['failed', 'delivery_failed', 'sending_failed'].includes(delivery);
  const timestamp = data.occurred_at || payload.completed_at || payload.sent_at || payload.received_at;
  if (!data.id || !payload.id || !Number.isFinite(Date.parse(timestamp))) throw new Error('Invalid carrier message event identity or timestamp.');
  return {
    id: payload.id, providerEventId: data.id, organizationId, transport: 'sms',
    to: recipient?.phone_number || (typeof payload.to === 'string' ? payload.to : ''),
    from: typeof payload.from === 'string' ? payload.from : payload.from?.phone_number || '',
    text: typeof payload.text === 'string' ? payload.text : '',
    direction: inbound ? 'inbound' : 'outbound',
    status: failed ? 'failed' : inbound ? 'received' : delivery === 'delivered' ? 'delivered' : 'sent',
    terminal: inbound || failed || delivery === 'delivered' || data.event_type === 'message.finalized',
    createdAt: new Date(payload.received_at || payload.sent_at || timestamp).toISOString(),
    updatedAt: new Date(timestamp).toISOString(),
    error: failed ? errors[0]?.detail || errors[0]?.title || 'Message delivery failed.' : undefined,
  };
}

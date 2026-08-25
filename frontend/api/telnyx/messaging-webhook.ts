import type { VercelRequest, VercelResponse } from '@vercel/node';
import { methodNotAllowed, requiredEnv } from '../_lib/http.js';
import { storeMessageEvent } from '../_lib/message-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (req.query.token !== requiredEnv('VOICE_WEBHOOK_SECRET')) return res.status(401).json({ error: 'Unauthorized' });
  const eventType = typeof req.body?.data?.event_type === 'string' ? req.body.data.event_type : 'unknown';
  const eventId = typeof req.body?.data?.id === 'string' ? req.body.data.id : 'unknown';
  const payload = req.body?.data?.payload ?? {};
  const messageId = typeof payload.id === 'string' ? payload.id : eventId;
  const from = typeof payload.from === 'string' ? payload.from : payload.from?.phone_number || '';
  const destination = Array.isArray(payload.to) ? payload.to[0]?.phone_number || '' : typeof payload.to === 'string' ? payload.to : '';
  const inbound = eventType === 'message.received' || payload.direction === 'inbound';
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  if (messageId !== 'unknown') {
    await storeMessageEvent({
      id: messageId,
      to: destination,
      from,
      text: typeof payload.text === 'string' ? payload.text : '',
      direction: inbound ? 'inbound' : 'outbound',
      status: errors.length ? 'failed' : inbound ? 'received' : 'sent',
      createdAt: payload.received_at || payload.sent_at || payload.completed_at || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: errors[0]?.detail || errors[0]?.title,
    });
  }
  console.info(`Telnyx messaging webhook received: type=${eventType}, id=${eventId}`);
  return res.status(200).json({ received: true });
}

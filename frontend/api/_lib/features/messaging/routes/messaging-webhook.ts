import { completeSend, sendFingerprint } from '../send-operation.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { methodNotAllowed } from '../../../shared/http.js';
import { storeMessageEvent } from '../message-store.js';
import { organizationForNumber } from '../../organizations/tenancy.js';
import { verifyTelnyxWebhook } from '../../../shared/telnyx-webhook-auth.js';
import { quarantineSecurityEvent } from '../../../shared/security-quarantine.js';
import { telnyxMessageEvent } from '../telnyx-message-event.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (!await verifyTelnyxWebhook(req)) return res.status(401).json({ error: 'Unauthorized' });
  const eventType = typeof req.body?.data?.event_type === 'string' ? req.body.data.event_type : 'unknown';
  const eventId = typeof req.body?.data?.id === 'string' ? req.body.data.id : 'unknown';
  const payload = req.body?.data?.payload ?? {};
  const messageId = typeof payload.id === 'string' ? payload.id : eventId;
  const from = typeof payload.from === 'string' ? payload.from : payload.from?.phone_number || '';
  const destination = Array.isArray(payload.to) ? payload.to[0]?.phone_number || '' : typeof payload.to === 'string' ? payload.to : '';
  const inbound = eventType === 'message.received' || payload.direction === 'inbound';
  const organizationId = await organizationForNumber(inbound ? destination : from);
  if (!organizationId) {
    await quarantineSecurityEvent({
      source: 'telnyx-messaging',
      reason: 'unresolved_number_ownership',
      eventId,
      details: { eventType, messageId, direction: inbound ? 'inbound' : 'outbound', from, destination },
    }).catch((error) => console.error('Failed to persist quarantined messaging event.', error));
    console.warn(`Quarantined unscoped Telnyx messaging event: type=${eventType}, id=${eventId}`);
    return res.status(202).json({ received: true, quarantined: true });
  }
  if (!inbound && typeof req.query.operation === 'string' && /^[a-f0-9]{64}$/.test(req.query.operation)) {
    await completeSend(req.query.operation, sendFingerprint(from, destination, String(payload.text || '')), {
      id:messageId, status:payload.to?.[0]?.status || 'sent', direction:'outbound', created_at:payload.sent_at || payload.received_at || new Date().toISOString(),
    });
  }
  if (messageId !== 'unknown') {
    await storeMessageEvent(telnyxMessageEvent(req.body.data, organizationId));
  }
  console.info(`Telnyx messaging webhook received: type=${eventType}, id=${eventId}`);
  return res.status(200).json({ received: true });
}

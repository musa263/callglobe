import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../_lib/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError, requiredEnv } from '../_lib/http.js';
import { telnyx, TelnyxApiError } from '../_lib/telnyx.js';
import { listStoredMessages, storeMessageEvent } from '../_lib/message-store.js';
import { listOwnedNumbers } from '../_lib/phone-number-access.js';
import { readPbxConfig } from '../_lib/pbx-config-store.js';
import { normalizeE164, numberOrganizationId, sessionOrganizationId } from '../_lib/tenancy.js';
import { requireFeature } from '../_lib/saas-access.js';
import { getExtension, listExtensions } from '../_lib/pbx.js';
import { randomUUID } from 'node:crypto';

const e164Pattern = /^\+[1-9]\d{6,14}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'POST'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST']);

  try {
    const session = await requireSession(req);
    const config = await readPbxConfig();
    await requireFeature(session, 'sms', config);
    const organizationId = sessionOrganizationId(session, config);
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ messages: await listStoredMessages(organizationId, session.extensionId) });
    }
    const toExtension = typeof req.body?.to_extension === 'string' ? req.body.to_extension.replace(/\D/g, '').slice(0, 5) : '';
    const to = typeof req.body?.to === 'string' ? req.body.to.replace(/[\s()-]/g, '') : '';
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 1600) return res.status(400).json({ error: 'Message text must contain between 1 and 1,600 characters.' });

    if (toExtension) {
      await requireFeature(session, 'internalCalling', config);
      if (!session.extensionId) return res.status(403).json({ error: 'A company extension is required for internal messaging.' });
      const [source, directory] = await Promise.all([getExtension(session.extensionId, organizationId), listExtensions(organizationId)]);
      const recipient = directory.find((item) => item.extension === toExtension && item.status === 'active');
      if (!recipient || recipient.id === source.id) return res.status(404).json({ error: 'Choose another active extension in your organization.' });
      const id = `internal-${randomUUID()}`;
      const createdAt = new Date().toISOString();
      await storeMessageEvent({
        id, to: `extension:${recipient.extension}`, from: `extension:${source.extension}`, text,
        direction: 'outbound', status: 'sent', createdAt, updatedAt: createdAt, organizationId,
        transport: 'internal', senderExtensionId: source.id, senderExtension: source.extension, senderName: source.name,
        recipientExtensionId: recipient.id, recipientExtension: recipient.extension, recipientName: recipient.name,
      });
      return res.status(200).json({ id, status: 'sent', direction: 'outbound', transport: 'internal', created_at: createdAt });
    }

    if (!e164Pattern.test(to)) return res.status(400).json({ error: 'Use a complete international number beginning with +.' });

    const from = normalizeE164(typeof req.body?.from === 'string' ? req.body.from : requiredEnv('TELNYX_SMS_FROM'));
    const ownedNumbers = await listOwnedNumbers();
    const sender = ownedNumbers.find((item) => normalizeE164(item.phone_number) === from);
    if (!sender || numberOrganizationId(from, config) !== organizationId) return res.status(403).json({ error: 'External SMS needs an SMS-enabled phone number assigned to your company.' });
    if (!sender.messaging_profile_id) return res.status(409).json({ error: 'This number is not attached to a Telnyx messaging profile.' });
    const response = await telnyx('/messages', {
      method: 'POST',
      body: JSON.stringify({ from, to, text, use_profile_webhooks: true }),
    });
    const payload = await response.json() as { data?: { id?: string; to?: Array<{ status?: string }>; sent_at?: string; received_at?: string } };
    const message = payload.data;
    if (!message?.id) throw new Error('Telnyx did not return a message identifier.');
    const createdAt = message.sent_at || message.received_at || new Date().toISOString();
    await storeMessageEvent({ id: message.id, to, from, text, direction: 'outbound', status: 'sent', createdAt, updatedAt: new Date().toISOString(), organizationId, transport: 'sms' });
    return res.status(200).json({
      id: message.id,
      status: message.to?.[0]?.status || 'queued',
      direction: 'outbound',
      created_at: createdAt,
    });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'SMS messaging is not enabled for this company.' });
    if (error instanceof TelnyxApiError && [400, 403, 404, 422].includes(error.status)) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}

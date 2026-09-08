import { reserveSend, completeSend, sendOperationKey, sendFingerprint } from '../send-operation.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError, requiredEnv } from '../../../shared/http.js';
import { telnyx, TelnyxApiError } from '../../../shared/telnyx.js';
import { listStoredMessages, storeMessageEvent } from '../message-store.js';
import { listOwnedNumbers } from '../../numbers/phone-number-access.js';
import { readPbxConfig } from '../../organizations/pbx-config-store.js';
import { normalizeE164, numberOrganizationId, sessionOrganizationId } from '../../organizations/tenancy.js';
import { requireFeature } from '../../organizations/saas-access.js';
import { getExtension, listExtensions } from '../../organizations/pbx.js';
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
    const operationId = typeof req.body?.operationId === 'string' ? req.body.operationId : '';
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(operationId)) return res.status(400).json({error:'Update Vocivo before sending this message; a message operation ID is required.'});
    if (!session.sub) return res.status(403).json({ error: 'A signed-in account is required to send messages.' });
    const operationKey = sendOperationKey(organizationId, session.sub, operationId);
    const fingerprint = sendFingerprint(from, to, text);
    const reserved = await reserveSend(operationKey, fingerprint);
    let result = reserved.operation.result;
    if (!reserved.created && !result) return res.status(202).json({id:operationId, status:'sending', direction:'outbound', pending:true});
    if (reserved.created) {
      const webhookUrl = new URL('/api/telnyx/messaging-webhook', requiredEnv('VITE_APP_URL'));
      webhookUrl.searchParams.set('operation', operationKey);
      // An ambiguous carrier response leaves a pending operation. Never send it again automatically.
      const response = await telnyx('/messages', { method:'POST', body:JSON.stringify({from,to,text,use_profile_webhooks:true,webhook_url:webhookUrl.href}) });
      const payload = await response.json() as {data?: {id?:string;to?:Array<{status?:string}>;sent_at?:string;received_at?:string}};
      if (!payload.data?.id) throw new Error('Telnyx did not return a message identifier.');
      result = {id:payload.data.id, status:payload.data.to?.[0]?.status || 'queued', direction:'outbound', created_at:payload.data.sent_at || payload.data.received_at || new Date().toISOString()};
      await completeSend(operationKey, fingerprint, result);
    }
    if (!result) throw new Error('Message operation is pending.');
    await storeMessageEvent({id:result.id,to,from,text,direction:'outbound',status:'sent',createdAt:result.created_at,updatedAt:result.created_at,organizationId,transport:'sms'});
    return res.status(200).json(result);
  } catch (error) {
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'SMS messaging is not enabled for this company.' });
    if (error instanceof TelnyxApiError && [400, 403, 404, 422].includes(error.status)) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}

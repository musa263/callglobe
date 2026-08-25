import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../_lib/auth.js';
import { allowMobile, methodNotAllowed, publicError, requiredEnv } from '../_lib/http.js';
import { telnyx, TelnyxApiError } from '../_lib/telnyx.js';
import { listStoredMessages, storeMessageEvent } from '../_lib/message-store.js';

const e164Pattern = /^\+[1-9]\d{6,14}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'POST'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST']);

  try {
    await requireSession(req);
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ messages: await listStoredMessages() });
    }
    const to = typeof req.body?.to === 'string' ? req.body.to.replace(/[\s()-]/g, '') : '';
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!e164Pattern.test(to)) return res.status(400).json({ error: 'Use a complete international number beginning with +.' });
    if (!text || text.length > 1600) return res.status(400).json({ error: 'Message text must contain between 1 and 1,600 characters.' });

    const response = await telnyx('/messages', {
      method: 'POST',
      body: JSON.stringify({ from: requiredEnv('TELNYX_SMS_FROM'), to, text, use_profile_webhooks: true }),
    });
    const payload = await response.json() as { data?: { id?: string; to?: Array<{ status?: string }>; sent_at?: string; received_at?: string } };
    const message = payload.data;
    if (!message?.id) throw new Error('Telnyx did not return a message identifier.');
    const createdAt = message.sent_at || message.received_at || new Date().toISOString();
    await storeMessageEvent({ id: message.id, to, from: requiredEnv('TELNYX_SMS_FROM'), text, direction: 'outbound', status: 'sent', createdAt, updatedAt: new Date().toISOString() });
    return res.status(200).json({
      id: message.id,
      status: message.to?.[0]?.status || 'queued',
      direction: 'outbound',
      created_at: createdAt,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof TelnyxApiError && [400, 403, 404, 422].includes(error.status)) return res.status(error.status).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}

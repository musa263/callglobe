import type { VercelRequest, VercelResponse } from '@vercel/node';
import { storeCallEvent } from '../call-event-store.js';
import { methodNotAllowed, publicError } from '../http.js';
import { verifyPbxRequest } from '../pbx-internal-auth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    verifyPbxRequest(req);
    const event = req.body && typeof req.body === 'object' ? req.body : {};
    if (event.schema !== 'vocivo.call-event.v1' || !event.eventId || !event.callId || !event.eventName) {
      return res.status(400).json({ error: 'Invalid call event.' });
    }
    await storeCallEvent({
      id: String(event.eventId),
      name: `freeswitch.${String(event.eventName).toLowerCase()}`,
      type: 'webhook',
      event_timestamp: new Date(event.occurredAt || Date.now()).toISOString(),
      call_session_id: String(event.sessionId || event.callId),
      call_leg_id: String(event.legId || event.callId),
      direction: String(event.direction || ''),
      from: String(event.caller?.number || event.caller?.extension || ''),
      to: String(event.destination || event.targetExtension || ''),
      hangup_cause: String(event.hangupCause || ''),
      organizationId: String(event.organizationId || 'primary'),
      flow: String(event.callType || 'voice'),
      sourceExtension: String(event.caller?.extension || ''),
      sourceName: String(event.caller?.name || ''),
      destinationExtension: String(event.targetExtension || ''),
    });
    return res.status(202).json({ accepted: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Unauthorized' });
    return res.status(500).json({ error: publicError(error) });
  }
}

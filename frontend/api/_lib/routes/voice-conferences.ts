import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, requiredEnv } from '../http.js';
import { authorizeOutboundCall } from '../outbound-policy.js';
import { assertCallerIdForSession } from '../phone-number-access.js';
import { getExtension } from '../pbx.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { sessionOrganizationId } from '../tenancy.js';
import { dialCall } from '../voice-control.js';

const e164 = /^\+[1-9]\d{6,14}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const session = await requireSession(req);
    const participants: string[] = Array.isArray(req.body?.participants)
      ? Array.from(new Set<string>(req.body.participants.map((item: unknown) => typeof item === 'string' ? item.replace(/[\s()-]/g, '') : '').filter((item: string) => e164.test(item)))).slice(0, 5)
      : [];
    if (participants.length < 2) return res.status(400).json({ error: 'Add at least two complete international numbers.' });
    const config = await readPbxConfig();
    const organizationId = sessionOrganizationId(session, config);
    const profile = session.extensionId ? config.userProfiles[session.extensionId] : undefined;
    const requestedCallerId = typeof req.body?.callerId === 'string' && req.body.callerId.trim()
      ? req.body.callerId
      : profile?.outboundCallerId || config.company.defaultCallerId || requiredEnv('TELNYX_SMS_FROM');
    const callerId = await assertCallerIdForSession(session, requestedCallerId);
    const extension = session.extensionId ? await getExtension(session.extensionId) : undefined;
    for (const participant of participants) {
      authorizeOutboundCall(config, {
        extension: extension?.extension,
        department: extension?.department,
        internationalAllowed: profile?.permissions?.international !== false,
      }, participant, callerId);
    }
    const hostDestination = extension?.sipUsername ? `sip:${extension.sipUsername}@sip.telnyx.com` : requiredEnv('TELNYX_SIP_URI');
    const room = `vocivo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await dialCall({
      to: hostDestination,
      from: callerId,
      state: { flow: 'conference_host', room, participants, callerId, organizationId },
      fromDisplayName: 'Vocivo Conference',
    });
    return res.status(200).json({ room, host_call_id: result.data?.call_control_id, participants: participants.length });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && /Caller ID|organization|owned|verified|outbound rule|International calling/i.test(error.message)) return res.status(403).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}

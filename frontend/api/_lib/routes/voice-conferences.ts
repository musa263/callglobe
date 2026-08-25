import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, requiredEnv } from '../http.js';
import { dialCall } from '../voice-control.js';

const e164 = /^\+[1-9]\d{6,14}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    await requireSession(req);
    const participants: string[] = Array.isArray(req.body?.participants)
      ? Array.from(new Set<string>(req.body.participants.map((item: unknown) => typeof item === 'string' ? item.replace(/[\s()-]/g, '') : '').filter((item: string) => e164.test(item)))).slice(0, 5)
      : [];
    if (participants.length < 2) return res.status(400).json({ error: 'Add at least two complete international numbers.' });
    const room = `vocivo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await dialCall({
      to: requiredEnv('TELNYX_SIP_URI'),
      state: { flow: 'conference_host', room, participants },
      fromDisplayName: 'Vocivo Conference',
    });
    return res.status(200).json({ room, host_call_id: result.data?.call_control_id, participants: participants.length });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

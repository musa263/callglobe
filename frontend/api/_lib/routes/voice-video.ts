import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { telnyx } from '../telnyx.js';
import { readUserProfile } from '../profile-store.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const session = await requireSession(req);
    let roomId = typeof req.body?.roomId === 'string' ? req.body.roomId.trim() : '';
    if (!roomId) {
      const roomResponse = await telnyx('/rooms', { method: 'POST', body: JSON.stringify({ unique_name: `Vocivo-${Date.now()}`, max_participants: 8, enable_recording: false }) });
      const roomPayload = await roomResponse.json() as { data?: { id?: string } };
      roomId = roomPayload.data?.id || '';
    }
    if (!/^[0-9a-f-]{36}$/i.test(roomId)) return res.status(400).json({ error: 'Enter a valid Vocivo meeting code.' });
    const tokenResponse = await telnyx(`/rooms/${encodeURIComponent(roomId)}/actions/generate_join_client_token`, { method: 'POST', body: JSON.stringify({ token_ttl_secs: 3600, refresh_token_ttl_secs: 7200 }) });
    const tokenPayload = await tokenResponse.json() as { data?: { token?: string; token_expires_at?: string } };
    if (!tokenPayload.data?.token) throw new Error('Telnyx did not return a video room token.');
    res.setHeader('Cache-Control', 'no-store');
    const profile = await readUserProfile(session.sub || 'vocivo-user');
    return res.status(201).json({ roomId, token: tokenPayload.data.token, tokenExpiresAt: tokenPayload.data.token_expires_at, participantName: profile?.fullName || session.name || session.email || session.extension || 'Vocivo user', participantPhotoUrl: profile?.photoUrl });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

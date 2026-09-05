import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { telnyx } from '../../../shared/telnyx.js';
import { readUserProfile } from '../../auth/profile-store.js';
import { readPbxConfig } from '../../organizations/pbx-config-store.js';
import { sessionOrganizationId } from '../../organizations/tenancy.js';
import { readVideoRoom, saveVideoRoom } from '../video-room-store.js';
import { requireFeature } from '../../organizations/saas-access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const session = await requireSession(req);
    const config = await readPbxConfig();
    await requireFeature(session, 'videoCalling', config);
    const organizationId = sessionOrganizationId(session, config);
    if (session.extensionId && config.userProfiles[session.extensionId]?.permissions.video === false) return res.status(403).json({ error: 'Video calling is disabled for this extension.' });
    let roomId = typeof req.body?.roomId === 'string' ? req.body.roomId.trim() : '';
    if (!roomId) {
      const roomResponse = await telnyx('/rooms', { method: 'POST', body: JSON.stringify({ unique_name: `Vocivo-${Date.now()}`, max_participants: 8, enable_recording: false }) });
      const roomPayload = await roomResponse.json() as { data?: { id?: string } };
      roomId = roomPayload.data?.id || '';
      if (roomId) await saveVideoRoom({ roomId, organizationId, createdBy: session.sub || 'vocivo-user', createdAt: new Date().toISOString() });
    }
    if (!/^[0-9a-f-]{36}$/i.test(roomId)) return res.status(400).json({ error: 'Enter a valid Vocivo meeting code.' });
    const room = await readVideoRoom(roomId);
    if (!room || room.organizationId !== organizationId) return res.status(404).json({ error: 'This meeting is not available to your organization.' });
    const tokenResponse = await telnyx(`/rooms/${encodeURIComponent(roomId)}/actions/generate_join_client_token`, { method: 'POST', body: JSON.stringify({ token_ttl_secs: 3600, refresh_token_ttl_secs: 7200 }) });
    const tokenPayload = await tokenResponse.json() as { data?: { token?: string; token_expires_at?: string } };
    if (!tokenPayload.data?.token) throw new Error('Telnyx did not return a video room token.');
    res.setHeader('Cache-Control', 'no-store');
    const profile = await readUserProfile(session.sub || 'vocivo-user');
    return res.status(201).json({ roomId, token: tokenPayload.data.token, tokenExpiresAt: tokenPayload.data.token_expires_at, participantName: profile?.fullName || session.name || session.email || session.extension || 'Vocivo user', participantPhotoUrl: profile?.photoUrl });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'Video calling is not enabled for this company.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { readPbxConfig } from '../../organizations/pbx-config-store.js';
import { accessForSession, requireFeature } from '../../organizations/saas-access.js';
import { listExtensions } from '../../organizations/pbx.js';
import { readVideoRoom } from '../../video/video-room-store.js';
import { MeetingError, meetingStore, validateMeeting } from '../meeting-store.js';

const dependencies = { requireSession, readPbxConfig, accessForSession, requireFeature, listExtensions, readVideoRoom, meetingStore };
export function createMeetingsHandler(deps = dependencies) {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (allowMobile(req, res)) return;
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE']);
    try {
      const session = await deps.requireSession(req);
      if (!session.organizationId || !session.sub || session.accountType === 'platform') throw new MeetingError('A customer account is required.', 403);
      const config = await deps.readPbxConfig();
      await deps.accessForSession(session, config);
      const scope = { organizationId: session.organizationId, ownerId: session.sub };
      res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'GET') return res.status(200).json({ meetings: await deps.meetingStore.list(scope) });
      if (req.method === 'DELETE') {
        if (typeof req.body?.id !== 'string' || !Number.isSafeInteger(req.body?.version) || req.body.version < 1) throw new MeetingError('Meeting ID and version are required.');
        await deps.meetingStore.remove(scope, req.body.id, req.body.version);
        return res.status(200).json({ success: true });
      }
      const meeting = validateMeeting(req.body);
      if (req.method === 'PATCH' && (!Number.isSafeInteger(req.body?.version) || req.body.version < 1)) throw new MeetingError('Meeting version is required.');
      if (meeting.kind === 'video') {
        await deps.requireFeature(session, 'videoCalling', config);
        if (session.extensionId && config.userProfiles[session.extensionId]?.permissions.video === false) throw new MeetingError('Video calling is disabled for this extension.', 403);
        const room = await deps.readVideoRoom(meeting.roomId);
        if (!room || room.organizationId !== scope.organizationId) throw new MeetingError('Meeting is not available to your organization.', 404);
      } else if (!meeting.destination.startsWith('+')) {
        await deps.requireFeature(session, 'internalCalling', config);
        if (session.accountType !== 'business' || !config.organizations.find(item => item.id === scope.organizationId)?.internalCallingEnabled) throw new MeetingError('Company calling is unavailable.', 403);
        const directory = await deps.listExtensions(scope.organizationId);
        if (!directory.some(item => item.status === 'active' && item.extension === meeting.destination) || meeting.destination === session.extension) throw new MeetingError('Choose another active company extension.');
      }
      return res.status(req.method === 'POST' ? 201 : 200).json({ meeting: await deps.meetingStore.save(scope, meeting, req.method === 'PATCH' ? req.body.version : undefined) });
    } catch (error) {
      if (writeAuthError(res, error)) return;
      if (error instanceof MeetingError) return res.status(error.status).json({ error: error.message });
      if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/.test(error.message)) return res.status(403).json({ error: 'This feature is not available for your account.' });
      console.error('[meetings] Request failed.', { name: error instanceof Error ? error.name : 'Error' });
      return res.status(500).json({ error: publicError(error) });
    }
  };
}
export default createMeetingsHandler();

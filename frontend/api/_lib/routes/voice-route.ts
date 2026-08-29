import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { assertCallerIdForSession } from '../phone-number-access.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { authorizeOutboundCall } from '../outbound-policy.js';
import { getExtension, listExtensions } from '../pbx.js';
import { pbxForOrganization, readPbxConfig } from '../pbx-config-store.js';
import { readUserProfile } from '../profile-store.js';
import { sessionOrganizationId } from '../tenancy.js';
import { isVoiceRouteId } from '../voice-route-id.js';
import { saveVoiceRoute } from '../voice-route-store.js';
import { createVoiceRouteToken } from '../voice-route-token.js';
import { requireFeature } from '../saas-access.js';
import { parseInternalSipUser } from '../internal-sip.js';

const e164 = /^\+[1-9]\d{6,14}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const session = await requireSession(req);
    const routeId = typeof req.body?.routeId === 'string' ? req.body.routeId.trim() : '';
    const destination = typeof req.body?.destination === 'string' ? req.body.destination.replace(/[\s()-]/g, '') : '';
    const requestedFlow = req.body?.flow === 'internal' ? 'internal' : 'outbound';
    if (!isVoiceRouteId(routeId)) return res.status(400).json({ error: 'A valid call route is required.' });
    const config = await readPbxConfig();
    await requireFeature(session, requestedFlow === 'internal' ? 'internalCalling' : 'outboundCalling', config);
    const organizationId = sessionOrganizationId(session, config);
    let callerId: string | undefined;
    let callerName: string | undefined;
    let callerPhotoUrl: string | undefined;
    let callerExtension: string | undefined;
    let sourceExtensionId: string | undefined;
    let callerSipUsername: string | undefined;
    let destinationName: string | undefined;
    let destinationExtension: string | undefined;
    let destinationExtensionId: string | undefined;
    if (requestedFlow === 'internal') {
      const organization = config.organizations.find((item) => item.id === organizationId);
      const sipUser = organization ? parseInternalSipUser(destination) : null;
      if (!sipUser || organization?.accountType === 'individual' || !organization?.internalCallingEnabled) return res.status(403).json({ error: 'Internal calling is not enabled for this organization.' });
      if (!session.extensionId) return res.status(403).json({ error: 'A company extension is required for internal calling.' });
      const [directory, source, profile] = await Promise.all([
        listExtensions(organizationId),
        getExtension(session.extensionId),
        readUserProfile(`vocivo-extension:${session.extensionId}`),
      ]);
      const target = directory.find((item) => item.sipUsername === sipUser && item.status === 'active');
      if (!target || target.id === session.extensionId) return res.status(403).json({ error: 'That internal destination is not available to this account.' });
      if (source.organizationId !== organizationId || source.status !== 'active') return res.status(403).json({ error: 'Your company extension is not active.' });
      callerName = (profile?.fullName || source.name).replace(/[\r\n|]/g, ' ').trim().slice(0, 80);
      callerPhotoUrl = profile?.photoUrl && /^https:\/\//i.test(profile.photoUrl) ? profile.photoUrl.slice(0, 500) : undefined;
      callerExtension = source.extension;
      sourceExtensionId = source.id;
      callerSipUsername = source.sipUsername;
      destinationName = target.name;
      destinationExtension = target.extension;
      destinationExtensionId = target.id;
    } else {
      if (!e164.test(destination)) return res.status(400).json({ error: 'Use a complete international destination beginning with +.' });
      const profile = session.extensionId ? config.userProfiles[session.extensionId] : undefined;
      const preferredCallerId = typeof req.body?.callerId === 'string' && req.body.callerId.trim()
        ? req.body.callerId
        : profile?.outboundCallerId || config.company.defaultCallerId;
      if (!preferredCallerId) return res.status(409).json({ error: 'No caller ID is assigned to this account. Ask your administrator to assign a phone number or verified caller ID.' });
      const [resolvedCallerId, extension] = await Promise.all([
        assertCallerIdForSession(session, preferredCallerId),
        session.extensionId ? getExtension(session.extensionId) : Promise.resolve(undefined),
      ]);
      callerId = resolvedCallerId;
      authorizeOutboundCall(pbxForOrganization(config, organizationId), {
        extension: extension?.extension,
        department: extension?.department,
        internationalAllowed: profile?.permissions?.international !== false,
      }, destination, callerId);
    }
    const now = Date.now();
    const route = await saveVoiceRoute({
      routeId,
      userId: session.sub || 'vocivo-user',
      organizationId,
      destination,
      callerId,
      callerName,
      callerPhotoUrl,
      callerExtension,
      sourceExtensionId,
      callerSipUsername,
      destinationName,
      destinationExtension,
      destinationExtensionId,
      flow: requestedFlow,
      phase: 'dialing',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    });
    res.setHeader('Cache-Control', 'no-store');
    const routeToken = createVoiceRouteToken({
      routeId: route.routeId,
      organizationId: route.organizationId,
      destination: route.destination,
      callerId: route.callerId,
      callerName: route.callerName,
      callerPhotoUrl: route.callerPhotoUrl,
      callerExtension: route.callerExtension,
      sourceExtensionId: route.sourceExtensionId,
      callerSipUsername: route.callerSipUsername,
      destinationName: route.destinationName,
      destinationExtension: route.destinationExtension,
      destinationExtensionId: route.destinationExtensionId,
      flow: route.flow,
    });
    return res.status(201).json({
      routeId: route.routeId,
      routeToken,
      callerId: route.callerId,
      callerName: route.callerName,
      callerExtension: route.callerExtension,
      callerPhotoUrl: route.callerPhotoUrl,
      destinationName: route.destinationName,
      destinationExtension: route.destinationExtension,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'This calling feature is not enabled for your company.' });
    if (error instanceof Error && /Caller ID|organization|owned|verified|Internal calling|destination|outbound rule|International calling/i.test(error.message)) return res.status(403).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}

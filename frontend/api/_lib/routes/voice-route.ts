import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { assertCallerIdForSession } from '../phone-number-access.js';
import { allowMobile, methodNotAllowed, publicError, requiredEnv } from '../http.js';
import { authorizeOutboundCall } from '../outbound-policy.js';
import { getExtension, listExtensions } from '../pbx.js';
import { pbxForOrganization, readPbxConfig } from '../pbx-config-store.js';
import { readUserProfile } from '../profile-store.js';
import { sessionOrganizationId } from '../tenancy.js';
import { isVoiceRouteId } from '../voice-route-id.js';
import { saveVoiceRoute } from '../voice-route-store.js';
import { createVoiceRouteToken } from '../voice-route-token.js';
import { requireFeature } from '../saas-access.js';

const e164 = /^\+[1-9]\d{6,14}$/;
const internalSip = /^sip:([A-Za-z0-9_.-]+)@sip\.telnyx\.com$/i;

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
    let callerExtension: string | undefined;
    if (requestedFlow === 'internal') {
      const match = destination.match(internalSip);
      const organization = config.organizations.find((item) => item.id === organizationId);
      if (!match || organization?.accountType === 'individual' || !organization?.internalCallingEnabled) return res.status(403).json({ error: 'Internal calling is not enabled for this organization.' });
      const target = (await listExtensions(organizationId)).find((item) => item.sipUsername === match[1] && item.status === 'active');
      if (!target || target.id === session.extensionId) return res.status(403).json({ error: 'That internal destination is not available to this account.' });
      if (!session.extensionId) return res.status(403).json({ error: 'A company extension is required for internal calling.' });
      const source = await getExtension(session.extensionId);
      if (source.organizationId !== organizationId || source.status !== 'active') return res.status(403).json({ error: 'Your company extension is not active.' });
      const profile = await readUserProfile(`vocivo-extension:${source.id}`);
      callerName = (profile?.fullName || source.name).replace(/[\r\n|]/g, ' ').trim().slice(0, 80);
      callerExtension = source.extension;
    } else {
      if (!e164.test(destination)) return res.status(400).json({ error: 'Use a complete international destination beginning with +.' });
      const profile = session.extensionId ? config.userProfiles[session.extensionId] : undefined;
      const preferredCallerId = typeof req.body?.callerId === 'string' && req.body.callerId.trim()
        ? req.body.callerId
        : profile?.outboundCallerId || config.company.defaultCallerId || requiredEnv('TELNYX_SMS_FROM');
      callerId = await assertCallerIdForSession(session, preferredCallerId);
      const extension = session.extensionId ? await getExtension(session.extensionId) : undefined;
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
      callerExtension,
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
      callerExtension: route.callerExtension,
      flow: route.flow,
    });
    return res.status(201).json({ routeId: route.routeId, routeToken, callerId: route.callerId, callerName: route.callerName, callerExtension: route.callerExtension });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'This calling feature is not enabled for your company.' });
    if (error instanceof Error && /Caller ID|organization|owned|verified|Internal calling|destination|outbound rule|International calling/i.test(error.message)) return res.status(403).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}

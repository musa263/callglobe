import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { readActiveCallRoute, clearActiveCallRoute } from '../call-route-store.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { getExtension } from '../pbx.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { callAction } from '../voice-control.js';
import { organizationExtensionSipUri } from '../internal-sip.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const session = await requireSession(req);
    if (!session.extensionId) return res.status(403).json({ error: 'Transfers are available to organization extensions.' });
    const config = await readPbxConfig();
    if (config.userProfiles[session.extensionId]?.permissions.transfer === false) return res.status(403).json({ error: 'Call transfer is disabled for this extension.' });
    const targetId = typeof req.body?.targetExtensionId === 'string' ? req.body.targetExtensionId : '';
    if (!targetId || targetId === session.extensionId) return res.status(400).json({ error: 'Choose another colleague.' });
    const [route, target] = await Promise.all([readActiveCallRoute(session.extensionId), getExtension(targetId)]);
    if (!route) return res.status(409).json({ error: 'This call is not an active routed business call.' });
    if (target.status !== 'active' || !target.sipUsername) return res.status(409).json({ error: 'The selected colleague is not available.' });
    if (target.organizationId !== session.organizationId) return res.status(403).json({ error: 'Calls can only be transferred within your organization.' });
    await callAction(route.parentCallControlId, 'transfer', { to: organizationExtensionSipUri(config, target.organizationId, target.sipUsername), timeout_secs: 30 });
    await clearActiveCallRoute(session.extensionId);
    return res.status(200).json({ transferred: true, target: { extension: target.extension, name: target.name } });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

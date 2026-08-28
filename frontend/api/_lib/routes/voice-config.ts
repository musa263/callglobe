import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { getExtensionCredentials } from '../pbx.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { accessForSession } from '../saas-access.js';
import { sipWebSocketUrl, voiceIceServers, voiceProvider } from '../voice-provider.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const session = await requireSession(req);
    if (session.sub === 'vocivo-owner') return res.status(403).json({ error: 'Platform administrators do not have a calling extension.' });
    const access = await accessForSession(session);
    if (access.superadmin === false && !access.features.internalCalling && !access.features.outboundCalling) {
      return res.status(403).json({ error: 'Calling is not enabled for this account.' });
    }
    if (!session.extensionId) return res.status(403).json({ error: 'This administrator account does not have a calling extension.' });
    const [credential, config] = await Promise.all([
      getExtensionCredentials(session.extensionId),
      readPbxConfig(),
    ]);
    const provider = voiceProvider(config);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({
      provider,
      pbx_engine: provider,
      sip_user: credential.sipUsername,
      sip_password: credential.sipPassword,
      sip_domain: credential.sipDomain,
      websocket_url: provider === 'freeswitch' ? sipWebSocketUrl(config) : '',
      ice_servers: voiceIceServers(`${credential.extension.organizationId}:${credential.extension.id}`),
      extension: credential.extension.extension,
      organization_id: credential.extension.organizationId,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && ['Organization inactive', 'Subscription inactive'].includes(error.message)) return res.status(403).json({ error: 'Calling is unavailable while this company account is inactive.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

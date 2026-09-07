import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { getExtension } from '../../organizations/pbx.js';
import { readPbxConfig } from '../../organizations/pbx-config-store.js';
import { accessForSession } from '../../organizations/saas-access.js';
import { sipDomain, sipRealm, sipWsUri, voiceEdge, voiceIceServers } from '../voice-provider.js';
import { sessionOrganizationId } from '../../organizations/tenancy.js';

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
    const config = await readPbxConfig();
    const extension = await getExtension(session.extensionId);
    if (extension.organizationId !== sessionOrganizationId(session, config)) return res.status(403).json({ error: 'This extension belongs to another organization.' });
    const edge = voiceEdge(config);
    const provider = edge;
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({
      provider,
      voice_edge: edge,
      extension_authority: extension.sipProvider === 'vocivo' ? 'vocivo' : 'telnyx',
      pbx_engine: provider,
      authentication: edge === 'sip' ? 'digest' : 'token',
      token_endpoint: '/api/telnyx/token',
      sip_credentials_endpoint: '/api/voice/sip-credentials',
      sip_domain: edge === 'sip' ? sipDomain() : 'sip.telnyx.com',
      sip_realm: edge === 'sip' ? sipRealm() : 'sip.telnyx.com',
      sip_ws_uri: edge === 'sip' ? sipWsUri() : '',
      ice_servers: voiceIceServers(`${extension.organizationId}:${extension.id}`),
      extension: extension.extension,
      organization_id: extension.organizationId,
    });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && ['Organization inactive', 'Subscription inactive'].includes(error.message)) return res.status(403).json({ error: 'Calling is unavailable while this company account is inactive.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

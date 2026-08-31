import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../http.js';
import { getExtension } from '../pbx.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { digestHa1 } from '../sip-digest.js';
import { saveSipCredential } from '../sip-credential-store.js';
import { newSipPassword } from '../sip-edge-auth.js';
import { accessForSession } from '../saas-access.js';
import { sessionOrganizationId } from '../tenancy.js';
import { clientIceServers, sipDomain, sipRealm, sipWsUri, voiceEdge } from '../voice-provider.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const session = await requireSession(req);
    if (!session.extensionId || session.sub === 'vocivo-owner') return res.status(403).json({ error: 'A calling extension is required.' });
    const config = await readPbxConfig();
    const access = await accessForSession(session, config);
    if (access.superadmin === false && !access.features.internalCalling && !access.features.outboundCalling) {
      return res.status(403).json({ error: 'Calling is not enabled for this account.' });
    }
    const extension = await getExtension(session.extensionId);
    if (extension.organizationId !== sessionOrganizationId(session, config)) return res.status(403).json({ error: 'This extension belongs to another organization.' });
    if (!extension.sipUsername) return res.status(409).json({ error: 'This extension has no SIP username.' });
    const realm = sipRealm();
    const password = newSipPassword();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await saveSipCredential({
      username: extension.sipUsername,
      extensionId: extension.id,
      organizationId: extension.organizationId,
      realm,
      ha1: digestHa1(extension.sipUsername, realm, password),
      expiresAt,
    });
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({
      username: extension.sipUsername,
      password,
      realm,
      domain: sipDomain(),
      wsUri: sipWsUri(),
      expiresAt,
      expires_in: 3600,
      ice_servers: clientIceServers(voiceEdge(config), `${extension.organizationId}:${extension.id}`),
      voice_edge: voiceEdge(config),
    });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    return res.status(500).json({ error: publicError(error) });
  }
}

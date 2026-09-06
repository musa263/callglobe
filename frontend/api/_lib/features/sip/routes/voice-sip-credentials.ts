import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { getExtension } from '../../organizations/pbx.js';
import { readPbxConfig } from '../../organizations/pbx-config-store.js';
import { digestHa1 } from '../sip-digest.js';
import { revokeSipCredential, saveSipCredential } from '../sip-credential-store.js';
import { newSipPassword, sipCredentialClient, sipCredentialSession, validSipDeviceId } from '../sip-edge-auth.js';
import { accessForSession } from '../../organizations/saas-access.js';
import { sessionOrganizationId } from '../../organizations/tenancy.js';
import { sipDomain, sipRealm, sipWsUri, voiceEdge, voiceIceServers } from '../../calling/voice-provider.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['POST', 'DELETE'].includes(req.method || '')) return methodNotAllowed(res, ['POST', 'DELETE']);
  try {
    const session = await requireSession(req);
    if (!session.extensionId || session.sub === 'vocivo-owner') return res.status(403).json({ error: 'A calling extension is required.' });
    const config = await readPbxConfig();
    const extension = await getExtension(session.extensionId);
    if (extension.organizationId !== sessionOrganizationId(session, config)) return res.status(403).json({ error: 'This extension belongs to another organization.' });
    if (!extension.sipUsername) return res.status(409).json({ error: 'This extension has no SIP username.' });
    const sessionId = sipCredentialSession(session);
    const requestedDeviceId = req.method === 'DELETE' ? req.query.deviceId : req.body?.deviceId;
    if (requestedDeviceId !== undefined && !validSipDeviceId(requestedDeviceId)) return res.status(400).json({ error: 'Invalid calling device identifier.' });
    if (req.method === 'DELETE') {
      if (!validSipDeviceId(requestedDeviceId) || !validSipDeviceId(req.query.credentialId)) return res.status(400).json({ error: 'Calling device and credential identifiers are required.' });
      await revokeSipCredential(extension.sipUsername, { deviceId: requestedDeviceId, sessionId, credentialId: req.query.credentialId });
      return res.status(200).json({ revoked: true });
    }
    const access = await accessForSession(session, config);
    if (access.superadmin === false && !access.features.internalCalling && !access.features.outboundCalling) {
      return res.status(403).json({ error: 'Calling is not enabled for this account.' });
    }
    const deviceId = requestedDeviceId || randomUUID();
    const credentialId = randomUUID();
    const realm = sipRealm();
    const password = newSipPassword();
    // A phone registers once and then re-registers with the same password for
    // as long as the app is open. At an hour, the password died under a
    // running phone: the next re-registration was refused, the registrar
    // dropped the contact, and calls stopped arriving with nothing on screen
    // to say so. A week outlives any session, and the client asks for a fresh
    // one well before it runs out.
    const expiresIn = 7 * 24 * 60 * 60;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    await saveSipCredential({
      username: extension.sipUsername,
      extensionId: extension.id,
      organizationId: extension.organizationId,
      realm,
      ha1: digestHa1(extension.sipUsername, realm, password),
      expiresAt,
      client: sipCredentialClient(req),
      deviceId, sessionId, credentialId,
      issuedAt: new Date().toISOString(),
    });
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({
      username: extension.sipUsername,
      password,
      realm,
      domain: sipDomain(),
      wsUri: sipWsUri(),
      expiresAt,
      expires_in: expiresIn,
      deviceId, credentialId,
      ice_servers: voiceIceServers(`${extension.organizationId}:${extension.id}`),
      voice_edge: voiceEdge(config),
    });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    return res.status(500).json({ error: publicError(error) });
  }
}

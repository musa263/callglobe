import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { getExtension, getExtensionCredentials } from '../../organizations/pbx.js';
import { readPbxConfig } from '../../organizations/pbx-config-store.js';
import { accessForSession } from '../../organizations/saas-access.js';
import { telnyx } from '../../../shared/telnyx.js';
import { sessionOrganizationId } from '../../organizations/tenancy.js';
import { voiceEdge, voiceIceServers } from '../voice-provider.js';
import { telnyxTokenLifetime } from '../telnyx-token-lifetime.js';

function normalizeToken(raw: string) {
  const value = raw.trim();
  if (!value) return '';
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === 'string') return parsed.trim();
    if (parsed && typeof parsed === 'object') {
      const result = parsed as { data?: unknown; token?: unknown };
      const token = typeof result.data === 'string' ? result.data : result.token;
      if (typeof token === 'string') return token.trim();
    }
    return value;
  } catch {
    return value;
  }
}

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
    if (voiceEdge() === 'sip') return res.status(409).json({ error: 'Use Vocivo SIP device credentials for this calling engine.' });
    const extension = await getExtension(session.extensionId);
    if (extension.organizationId !== sessionOrganizationId(session, config)) return res.status(403).json({ error: 'This extension belongs to another organization.' });
    const credential = await getExtensionCredentials(session.extensionId, sessionOrganizationId(session, config));
    if (credential.provider !== 'telnyx' || !credential.credentialId) return res.status(409).json({ error: 'Telnyx calling is not enabled for this extension.' });
    const response = await telnyx(`/telephony_credentials/${encodeURIComponent(credential.credentialId)}/token`, { method: 'POST' });
    const token = normalizeToken(await response.text());
    if (!token) throw new Error('Telnyx did not return a voice token.');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({
      token,
      expires_in: telnyxTokenLifetime(token),
      ice_servers: voiceIceServers(`${credential.extension.organizationId}:${credential.extension.id}`),
    });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && ['Organization inactive', 'Subscription inactive'].includes(error.message)) return res.status(403).json({ error: 'Calling is unavailable while this company account is inactive.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

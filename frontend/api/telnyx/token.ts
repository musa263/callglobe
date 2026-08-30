import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../_lib/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../_lib/http.js';
import { getExtension, getExtensionCredentials } from '../_lib/pbx.js';
import { readPbxConfig } from '../_lib/pbx-config-store.js';
import { accessForSession } from '../_lib/saas-access.js';
import { telnyx } from '../_lib/telnyx.js';
import { sessionOrganizationId } from '../_lib/tenancy.js';
import { voiceIceServers } from '../_lib/voice-provider.js';

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

function tokenLifetime(token: string) {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return 3600;
    const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as { exp?: number };
    if (typeof claims.exp !== 'number') return 3600;
    return Math.max(60, Math.min(86_400, claims.exp - Math.floor(Date.now() / 1000)));
  } catch {
    return 3600;
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
    const extension = await getExtension(session.extensionId);
    if (extension.organizationId !== sessionOrganizationId(session, config)) return res.status(403).json({ error: 'This extension belongs to another organization.' });
    const credential = await getExtensionCredentials(session.extensionId);
    if (credential.provider !== 'telnyx' || !credential.credentialId) return res.status(409).json({ error: 'Telnyx calling is not enabled for this extension.' });
    const response = await telnyx(`/telephony_credentials/${encodeURIComponent(credential.credentialId)}/token`, { method: 'POST' });
    const token = normalizeToken(await response.text());
    if (!token) throw new Error('Telnyx did not return a voice token.');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({
      token,
      expires_in: tokenLifetime(token),
      ice_servers: voiceIceServers(`${credential.extension.organizationId}:${credential.extension.id}`),
    });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && ['Organization inactive', 'Subscription inactive'].includes(error.message)) return res.status(403).json({ error: 'Calling is unavailable while this company account is inactive.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

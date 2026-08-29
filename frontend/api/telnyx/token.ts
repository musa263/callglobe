import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../_lib/auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../_lib/http.js';
import { getExtension, getExtensionCredentials } from '../_lib/pbx.js';
import { readPbxConfig } from '../_lib/pbx-config-store.js';
import { accessForSession } from '../_lib/saas-access.js';
import { telnyx } from '../_lib/telnyx.js';
import { sessionOrganizationId } from '../_lib/tenancy.js';

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
    const token = await response.text();
    if (!token) throw new Error('Telnyx did not return a voice token.');
    return res.status(200).json({ token, expires_in: 86400 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && ['Organization inactive', 'Subscription inactive'].includes(error.message)) return res.status(403).json({ error: 'Calling is unavailable while this company account is inactive.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

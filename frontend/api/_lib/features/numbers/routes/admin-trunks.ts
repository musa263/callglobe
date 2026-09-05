import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { telnyx, telnyxCredentialConnectionPath } from '../../../shared/telnyx.js';
import { deleteTrunkPolicy, normalizeTrunkPolicy, readTrunkPolicies, saveTrunkPolicy, type TrunkPolicy } from '../trunk-policy-store.js';
import { requireFeature } from '../../organizations/saas-access.js';

type UacConnection = {
  id: string;
  connection_name?: string;
  active?: boolean;
  fqdn?: string;
  registration_status?: string;
  external_uac_settings?: { proxy?: string; username?: string; transport?: string };
  internal_uac_settings?: { destination_uri?: string };
};

function safeUac(item: UacConnection, policy?: TrunkPolicy) {
  return { id: item.id, name: item.connection_name || 'SIP trunk', active: Boolean(item.active), fqdn: item.fqdn || '', registrationStatus: item.registration_status || 'Unknown', proxy: item.external_uac_settings?.proxy || '', username: item.external_uac_settings?.username || '', transport: item.external_uac_settings?.transport || 'UDP', destinationUri: item.internal_uac_settings?.destination_uri || '', policy: policy || normalizeTrunkPolicy(item.id, {}) };
}

function text(value: unknown, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE']);
  try {
    const access = await requireAdmin(req);
    await requireFeature(access.session, 'sipTrunks');
    if (req.method === 'GET') {
      const [connectionResponse, uacResponse, policies] = await Promise.all([
        access.superadmin ? telnyx(telnyxCredentialConnectionPath()) : Promise.resolve(null),
        telnyx('/uac_connections?page[size]=100'),
        readTrunkPolicies(),
      ]);
      const connection = connectionResponse ? (await connectionResponse.json() as { data?: Record<string, any> }).data ?? {} : null;
      const uac = (await uacResponse.json() as { data?: UacConnection[] }).data ?? [];
      return res.status(200).json({
        vocivoTrunk: access.superadmin && connection ? { id: connection.id, name: connection.connection_name, active: connection.active, host: 'sip.telnyx.com', username: connection.record_type === 'ip_connection' ? '' : connection.user_name, registrationStatus: connection.record_type === 'ip_connection' ? 'IP authenticated' : connection.registration_status, codecs: connection.inbound?.codecs ?? [], outboundProfileId: connection.outbound?.outbound_voice_profile_id, sipUriCalling: connection.sip_uri_calling_preference || 'disabled', transport: connection.transport_protocol || 'UDP' } : null,
        externalTrunks: uac.filter((item) => access.superadmin || policies[item.id]?.organizationId === access.organizationId).map((item) => safeUac(item, policies[item.id])),
      });
    }
    const id = text(req.body?.id || req.query.id, 80);
    const currentPolicies = await readTrunkPolicies();
    if (id && !access.superadmin && currentPolicies[id]?.organizationId !== access.organizationId) return res.status(404).json({ error: 'SIP trunk not found.' });
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'Trunk ID is required.' });
      await telnyx(`/uac_connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await deleteTrunkPolicy(id);
      return res.status(200).json({ success: true });
    }
    if (req.method === 'POST' && id) return res.status(400).json({ error: 'Use PATCH to update an existing SIP trunk.' });
    if (req.method === 'PATCH' && !id) return res.status(400).json({ error: 'Trunk ID is required.' });
    const name = text(req.body?.name, 80);
    const proxy = text(req.body?.proxy, 200);
    const username = text(req.body?.username, 100);
    const password = text(req.body?.password, 160);
    const destinationUri = text(req.body?.destinationUri, 200);
    const transport = ['UDP', 'TCP', 'TLS'].includes(req.body?.transport) ? req.body.transport : 'TLS';
    if (!name || !proxy || !username || (!id && !password)) return res.status(400).json({ error: 'Name, proxy, username and password are required for a new trunk.' });
    const policyOrganizationId = access.superadmin ? text(req.body?.policy?.organizationId, 50) || currentPolicies[id]?.organizationId || '' : access.organizationId || '';
    if (!policyOrganizationId) return res.status(400).json({ error: 'Choose the customer organization that owns this SIP trunk.' });
    const body = {
      connection_name: name,
      active: req.body?.active !== false,
      external_uac_settings: { proxy, username, ...(password ? { password } : {}), transport },
      ...(destinationUri ? { internal_uac_settings: { destination_uri: destinationUri } } : {}),
    };
    const response = await telnyx(id ? `/uac_connections/${encodeURIComponent(id)}` : '/uac_connections', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    const payload = await response.json() as { data?: UacConnection };
    if (!payload.data) throw new Error('Telnyx did not return the saved SIP connection.');
    const policy = await saveTrunkPolicy(payload.data.id, { ...(req.body?.policy ?? {}), organizationId: policyOrganizationId });
    return res.status(id ? 200 : 201).json({ trunk: safeUac(payload.data, policy) });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'SIP trunk management is not enabled for this company.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

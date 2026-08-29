import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError } from '../http.js';
import { readBusinessVoiceConfig } from '../number-config.js';
import { listExtensions } from '../pbx.js';
import { telnyx, telnyxPstnConnectionPath } from '../telnyx.js';
import { readPbxConfig } from '../pbx-config-store.js';

async function data(path: string) {
  const response = await telnyx(path);
  return (await response.json() as { data?: unknown }).data;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const access = await requireAdmin(req);
    const config = await readPbxConfig();
    const organizationId = access.superadmin ? config.activeOrganizationId : access.organizationId!;
    const [balance, numbers, connection, extensions, business] = await Promise.all([
      access.superadmin ? data('/balance') as Promise<{ balance?: string; currency?: string }> : Promise.resolve(null),
      data('/phone_numbers?page[size]=250&filter[status]=active') as Promise<Array<{ id: string; phone_number: string; status?: string }>>,
      access.superadmin ? data(telnyxPstnConnectionPath()) as Promise<{ active?: boolean; registration_status?: string; connection_name?: string; ios_push_credential_id?: string | null; record_type?: string }> : Promise.resolve(null),
      listExtensions(organizationId),
      readBusinessVoiceConfig(organizationId),
    ]);
    return res.status(200).json({
      metrics: {
        balance: access.superadmin ? Number(balance?.balance || 0) : null,
        currency: access.superadmin ? balance?.currency || 'USD' : null,
        phoneNumbers: Array.isArray(numbers) ? numbers.filter((item) => config.numberAssignments[item.phone_number]?.organizationId === organizationId).length : 0,
        extensions: extensions.length,
        activeExtensions: extensions.filter((item) => item.status === 'active').length,
      },
      phoneNumbers: Array.isArray(numbers) ? numbers.filter((item) => config.numberAssignments[item.phone_number]?.organizationId === organizationId).map(({ id, phone_number, status }) => ({ id, phone_number, status })) : [],
      connection: access.superadmin ? { name: connection?.connection_name || 'Vocivo Dedicated PBX', active: Boolean(connection?.active), registrationStatus: connection?.record_type === 'ip_connection' ? 'IP authenticated' : connection?.registration_status || 'Unknown', pushConfigured: Boolean(connection?.ios_push_credential_id) } : null,
      business,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, requiredEnv } from '../http.js';
import { readBusinessVoiceConfig } from '../number-config.js';
import { listExtensions } from '../pbx.js';
import { telnyx } from '../telnyx.js';
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
    const organizationId = access.organizationId || config.activeOrganizationId;
    const [balance, numbers, connection, extensions, business] = await Promise.all([
      access.superadmin ? data('/balance') as Promise<{ balance?: string; currency?: string }> : Promise.resolve(null),
      data('/phone_numbers?page[size]=250&filter[status]=active') as Promise<Array<{ id: string; phone_number: string; status?: string }>>,
      data(`/credential_connections/${requiredEnv('TELNYX_CONNECTION_ID')}`) as Promise<{ active?: boolean; registration_status?: string; connection_name?: string; ios_push_credential_id?: string | null }>,
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
      connection: { name: connection?.connection_name || 'Vocivo Mobile', active: Boolean(connection?.active), registrationStatus: connection?.registration_status || 'Unknown', pushConfigured: Boolean(connection?.ios_push_credential_id) },
      business,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    return res.status(500).json({ error: publicError(error) });
  }
}

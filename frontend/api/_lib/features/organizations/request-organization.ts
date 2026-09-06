import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { VocivoSession } from '../auth/auth.js';
import type { PbxConfig } from './pbx-config-store.js';
import { sessionOrganizationId } from './tenancy.js';

export class TenantScopeError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

// Call only after session verification. A workspace is request-local, never a
// platform-wide selection. The sole default is the initial read-only PBX view.
export function requestOrganizationId(
  req: Pick<VercelRequest, 'query' | 'method'>,
  session: VocivoSession,
  config: PbxConfig,
  options: { allowInitialRead?: boolean } = {},
) {
  const value = req.query.organizationId;
  if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
    throw new TenantScopeError(400, 'Choose one customer workspace.');
  }
  const requested = typeof value === 'string' ? value.trim() : '';
  const platform = session.sub === 'vocivo-owner' && ['owner', 'superadmin'].includes(session.role || '');
  if (!platform) {
    const own = sessionOrganizationId(session, config);
    if (requested && requested !== own) throw new TenantScopeError(403, 'This workspace belongs to another organization.');
    return own;
  }
  const organizationId = requested || (options.allowInitialRead && req.method === 'GET' ? config.activeOrganizationId : '');
  if (!organizationId) throw new TenantScopeError(400, 'Choose a customer workspace before continuing.');
  if (!config.organizations.some((item) => item.id === organizationId)) throw new TenantScopeError(404, 'Customer workspace not found.');
  return organizationId;
}

export function writeTenantScopeError(res: VercelResponse, error: unknown) {
  if (!(error instanceof TenantScopeError)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

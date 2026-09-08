import { createHash } from 'node:crypto';
import { claimReplayKey, releaseReplayKey } from '../../shared/object-store.js';

/** One cross-instance mutation per tenant. Lease outlasts the 30-second API deadline. */
export async function acquireTenantMutation(organizationId: string) {
  const key = `tenant-mutation:${createHash('sha256').update(organizationId).digest('hex')}`;
  if (!await claimReplayKey(key, new Date(Date.now() + 120_000))) throw new Error('Tenant mutation in progress. Retry after refreshing.');
  return () => releaseReplayKey(key);
}

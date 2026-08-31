import { listExtensions, listExtensionSipUsernames } from './pbx.js';
import type { PbxConfig } from './pbx-config-store.js';
import { sipInboundEnabled } from './voice-provider.js';
import { normalizeE164 } from './tenancy.js';

export type SipInboundLookup = {
  enabled: boolean;
  reason?: string;
  organizationId?: string;
  usernames: string[];
  bridge: string;
};

export async function lookupSipInbound(to: string, config: PbxConfig): Promise<SipInboundLookup> {
  if (!sipInboundEnabled()) {
    return { enabled: false, reason: 'call_control', usernames: [], bridge: '' };
  }
  const did = normalizeE164(to);
  const assignment = config.numberAssignments[did];
  if (!assignment?.organizationId) {
    return { enabled: false, reason: 'unassigned', usernames: [], bridge: '' };
  }
  const directory = await listExtensions(assignment.organizationId);
  let usernames: string[] = [];
  if (assignment.destinationType === 'extension' && assignment.destinationId) {
    usernames = await listExtensionSipUsernames(assignment.destinationId);
  } else {
    usernames = directory.filter((item) => item.status === 'active' && item.sipUsername).map((item) => item.sipUsername);
  }
  const unique = [...new Set(usernames.filter(Boolean))];
  return {
    enabled: unique.length > 0,
    reason: unique.length ? undefined : 'no_contacts',
    organizationId: assignment.organizationId,
    usernames: unique,
    bridge: unique.map((username) => `sofia/external/${username}@127.0.0.1:5060`).join(','),
  };
}

import { listExtensions, listExtensionSipUsernames } from './pbx.js';
import { pbxForOrganization, type PbxConfig } from './pbx-config-store.js';
import { numberUsesSipInbound, sipInboundBlockedReason, voiceWalletCharge } from './inbound-billing.js';
import { sipInboundEnabled } from './voice-provider.js';
import { normalizeE164 } from './tenancy.js';

export type SipInboundLookup = {
  enabled: boolean;
  reason?: string;
  organizationId?: string;
  usernames: string[];
  bridge: string;
  wallet?: { charged: boolean; reason: string };
};

async function sipUsernamesForAssignment(config: PbxConfig, assignment: PbxConfig['numberAssignments'][string]) {
  const organizationId = assignment.organizationId;
  if (assignment.destinationType === 'extension' && assignment.destinationId) {
    return listExtensionSipUsernames(assignment.destinationId);
  }
  if (assignment.destinationType === 'ring_group' && assignment.destinationId) {
    const group = pbxForOrganization(config, organizationId).callHandling.ringGroups.find((item) => item.id === assignment.destinationId);
    const names = await Promise.all((group?.members || []).map((memberId) => listExtensionSipUsernames(memberId)));
    return names.flat();
  }
  const directory = await listExtensions(organizationId);
  return directory.filter((item) => item.status === 'active' && item.sipUsername).map((item) => item.sipUsername);
}

export async function lookupSipInbound(to: string, config: PbxConfig): Promise<SipInboundLookup> {
  const did = normalizeE164(to);
  const assignment = config.numberAssignments[did];
  const wallet = voiceWalletCharge('inbound');
  if (!assignment?.organizationId) {
    return { enabled: false, reason: 'unassigned', usernames: [], bridge: '', wallet };
  }
  const sipNumber = numberUsesSipInbound(assignment);
  if (!sipNumber && !sipInboundEnabled()) {
    return { enabled: false, reason: sipInboundBlockedReason(assignment) || 'call_control', usernames: [], bridge: '', wallet };
  }
  if (!sipNumber) {
    const blocked = sipInboundBlockedReason(assignment);
    if (blocked === 'call_control_features') {
      return { enabled: false, reason: blocked, usernames: [], bridge: '', wallet };
    }
  }
  const usernames = await sipUsernamesForAssignment(config, assignment);
  const unique = [...new Set(usernames.filter(Boolean))];
  return {
    enabled: unique.length > 0,
    reason: unique.length ? undefined : 'no_contacts',
    organizationId: assignment.organizationId,
    usernames: unique,
    bridge: unique.map((username) => `sofia/external/${username}@127.0.0.1:5060`).join(','),
    wallet,
  };
}

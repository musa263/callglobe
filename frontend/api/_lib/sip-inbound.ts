import { listExtensions, listExtensionSipUsernames } from './pbx.js';
import { pbxForOrganization, type PbxConfig } from './pbx-config-store.js';
import { planSipInbound, planSipInboundDigit, type SipInboundPlan } from './sip-inbound-plan.js';
import { normalizeE164 } from './tenancy.js';

export type SipInboundLookup = SipInboundPlan & {
  usernames: string[];
  bridge: string;
};

function sofiaBridge(usernames: string[]) {
  const unique = [...new Set(usernames.filter(Boolean))];
  return unique.map((username) => `sofia/external/${username}@127.0.0.1:5060`).join(',');
}

async function usernamesForPlan(config: PbxConfig, plan: SipInboundPlan, did: string) {
  if (!plan.organizationId || plan.action === 'closed' || plan.action === 'ivr' || plan.action === 'ai' || plan.action === 'none') {
    return [];
  }
  const assignment = config.numberAssignments[did];
  const handlingId = plan.handlingId || assignment?.destinationId;
  if (plan.target?.startsWith('extension:')) {
    return listExtensionSipUsernames(plan.target.slice('extension:'.length));
  }
  if ((assignment?.destinationType === 'extension' || plan.target?.startsWith('extension:')) && handlingId) {
    return listExtensionSipUsernames(handlingId);
  }
  const pbx = pbxForOrganization(config, plan.organizationId);
  if (plan.action === 'queue' && handlingId) {
    const queue = pbx.callHandling.queues.find((item) => item.id === handlingId);
    const names = await Promise.all((queue?.members || []).map((memberId) => listExtensionSipUsernames(memberId)));
    return names.flat();
  }
  if ((assignment?.destinationType === 'ring_group' || plan.target?.startsWith('ring_group:')) && handlingId) {
    const group = pbx.callHandling.ringGroups.find((item) => item.id === handlingId);
    const names = await Promise.all((group?.members || []).map((memberId) => listExtensionSipUsernames(memberId)));
    return names.flat();
  }
  const directory = await listExtensions(plan.organizationId);
  if (plan.target?.startsWith('department:')) {
    const department = plan.target.slice('department:'.length).toLowerCase();
    return directory.filter((item) => item.status === 'active' && item.sipUsername && item.department?.toLowerCase() === department).map((item) => item.sipUsername);
  }
  return directory.filter((item) => item.status === 'active' && item.sipUsername).map((item) => item.sipUsername);
}

async function withBridge(config: PbxConfig, plan: SipInboundPlan, did: string): Promise<SipInboundLookup> {
  if (!plan.enabled) return { ...plan, usernames: [], bridge: '' };
  if (plan.action === 'ivr' || plan.action === 'ai' || plan.action === 'closed') {
    return { ...plan, usernames: [], bridge: '' };
  }
  const usernames = [...new Set((await usernamesForPlan(config, plan, did)).filter(Boolean))];
  return {
    ...plan,
    enabled: usernames.length > 0,
    reason: usernames.length ? plan.reason : 'no_contacts',
    usernames,
    bridge: sofiaBridge(usernames),
  };
}

export async function lookupSipInbound(to: string, config: PbxConfig): Promise<SipInboundLookup> {
  return withBridge(config, planSipInbound(to, config), normalizeE164(to));
}

export async function lookupSipInboundDigit(to: string, digit: string, config: PbxConfig): Promise<SipInboundLookup> {
  return withBridge(config, planSipInboundDigit(to, digit, config), normalizeE164(to));
}

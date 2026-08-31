export type VoiceBillableFlow = 'inbound' | 'internal' | 'outbound';

export type NumberAssignmentSource = 'owned' | 'verified' | 'sip_trunk';

const callControlOnlyTypes = new Set(['ivr', 'queue', 'ai', 'voicemail', 'conference', 'configured_ivr', 'agent']);

export function voiceWalletCharge(flow: VoiceBillableFlow) {
  if (flow === 'inbound') return { charged: false as const, reason: 'inbound_free' };
  if (flow === 'internal') return { charged: false as const, reason: 'internal_free' };
  return { charged: true as const, reason: 'outbound_pstn' };
}

export function numberSource(assignment?: { source?: string; destinationType?: string } | null): NumberAssignmentSource {
  if (assignment?.source === 'sip_trunk' || assignment?.source === 'owned' || assignment?.source === 'verified') {
    return assignment.source;
  }
  return assignment?.destinationType ? 'owned' : 'verified';
}

export function numberReceivesCalls(assignment?: { source?: string; destinationType?: string } | null) {
  const source = numberSource(assignment);
  if (source === 'verified') return false;
  if (source === 'sip_trunk') return true;
  return Boolean(assignment?.destinationType);
}

export function numberUsesSipInbound(assignment?: { source?: string; destinationType?: string } | null) {
  return numberSource(assignment) === 'sip_trunk';
}

export function sipInboundBlockedReason(assignment?: { source?: string; destinationType?: string } | null) {
  if (numberSource(assignment) === 'sip_trunk') return '';
  if (callControlOnlyTypes.has(assignment?.destinationType || '')) return 'call_control_features';
  return 'call_control';
}

export const SIP_TRUNK_NUMBER_PREFIX = 'sip-trunk:';

export function sipTrunkNumberId(phoneNumber: string) {
  return `${SIP_TRUNK_NUMBER_PREFIX}${phoneNumber}`;
}

export function isSipTrunkNumberId(id: string) {
  return id.startsWith(SIP_TRUNK_NUMBER_PREFIX);
}
